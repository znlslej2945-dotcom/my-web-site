// ============================================================================
// Supabase 연동 — 로컬 우선 + 백그라운드 동기화 레이어
// ============================================================================
// 이 파일은 script.js의 저장소 경계 함수(getUserSettings/setUserSettings,
// loadWorkDataForLog/saveWorkDataForLog)와 로그인 관련 함수가 호출해서 쓰는
// "Supabase 쪽 구현"만 모아둔다. workData/settings를 메모리에서 직접 읽고 쓰는
// 화면 렌더링/계산 로직(script.js의 수백 곳)은 이 파일의 존재를 전혀 몰라도 된다.
//
// 아키텍처 요약:
// - 로그인 성공 시 initSettingsFromSupabase/initWorkDataFromSupabase가 Supabase의
//   데이터를 읽어와 기존 코드가 이미 쓰던 것과 똑같은 모양으로 조립한 뒤
//   localStorage(userSettings/workData...)에 그대로 덮어쓴다. getUserSettings()/
//   loadWorkDataForLog()는 원래도 localStorage를 동기적으로 읽는 함수라서,
//   이렇게 하면 "메모리에 주입"한 것과 동일한 효과를 내면서 호출부를 전혀 바꾸지
//   않아도 된다.
// - 사용자가 뭔가 저장할 때는 지금처럼 즉시 localStorage에 동기 저장하고,
//   Supabase 업서트는 queueBackgroundSave(기존 인프라, 디바운스+재시도+토스트 내장)
//   에 실려 백그라운드로 돌아간다. 실패해도 로컬 저장은 이미 끝난 뒤라 사용자
//   흐름을 막지 않는다.
// - 각 로컬 차량(car)/거래처(client) 객체에는 최초 업서트 시 Supabase가 발급한
//   uuid를 supabaseId 필드로 캐싱해서 이후 update에 재사용한다.
// - Supabase 각 테이블의 raw jsonb 컬럼에는 로컬 원본 객체를 통째로 저장해서,
//   타입 컬럼 이름을 다소 잘못 추측하더라도 재조립(로드) 시에는 항상 raw를
//   기준으로 삼아 데이터 유실이 없도록 한다.
// ============================================================================

// ---------- Supabase 클라이언트 준비 ----------

window.__supabaseReadyPromise = window.__supabaseReadyPromise || new Promise(resolve => {
    if (window.supabaseClient) { resolve(window.supabaseClient); return; }
    window.addEventListener('supabase-ready', () => resolve(window.supabaseClient), { once: true });
});

async function getSupabaseClient() {
    if (window.supabaseClient) return window.supabaseClient;
    return window.__supabaseReadyPromise;
}

async function getSupabaseUser() {
    try {
        const client = await getSupabaseClient();
        const { data } = await client.auth.getSession();
        return data?.session?.user || null;
    } catch (error) {
        console.error('Supabase 세션 조회 실패:', error);
        return null;
    }
}

// ---------- 휴대전화번호 <-> 가짜 이메일 변환 (Supabase Auth는 이메일/비밀번호 방식만 사용) ----------

// 주의: Supabase의 이메일 검증기는 `.internal`, `.local` 같은 비표준 TLD를
// "invalid" 이메일로 거부한다(실제 이 프로젝트에서 확인됨). 반드시 유효한 TLD를 써야 한다.
function phoneToFakeEmail(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return `${digits}@runlog-user.com`;
}

function getSupabaseAuthErrorMessage(error) {
    const msg = error?.message || '';
    if (/already registered|already exists|user already/i.test(msg)) return '이미 가입된 휴대전화 번호입니다. "로그인"으로 전환해 주세요.';
    if (/invalid login credentials/i.test(msg)) return '이름/전화번호 또는 비밀번호가 올바르지 않습니다. 처음이시라면 "회원가입"으로 전환해 주세요.';
    if (/password.*(at least|6 characters)/i.test(msg)) return '비밀번호는 6자 이상이어야 합니다.';
    if (/network|fetch/i.test(msg)) return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    return msg || '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

// ---------- 로그인 / 회원가입 ----------

async function supabaseSignUp(email, password) {
    const client = await getSupabaseClient();
    return client.auth.signUp({ email, password });
}

async function supabaseSignIn(email, password) {
    const client = await getSupabaseClient();
    return client.auth.signInWithPassword({ email, password });
}

async function supabaseSignOutSafely() {
    try {
        const client = await getSupabaseClient();
        await client.auth.signOut();
    } catch (error) {
        console.error('Supabase 로그아웃 실패:', error);
    }
}

// profiles 행 생성(회원가입 직후 1회). 이미 있으면 upsert라 덮어써도 안전하다.
async function ensureProfileRow(userId, accountType, name, phone) {
    try {
        const client = await getSupabaseClient();
        const { error } = await client.from('profiles').upsert({
            id: userId,
            account_type: accountType || null,
            name: name || null,
            phone: phone || null
        });
        if (error) console.error('profiles 생성 실패:', error);
    } catch (error) {
        console.error('profiles 생성 실패:', error);
    }
}

// 로그인 화면에 처음 보여줄 탭(로그인/회원가입)을 추정한다.
// - 이 기기에서 Supabase 인증에 성공한 적이 한 번도 없는데 예전 로컬 로그인 흔적(휴대전화번호)만
//   남아있다면 "이 업데이트 이전부터 쓰던 기존 유저"일 가능성이 높으므로 회원가입을 기본값으로 둔다.
function getDefaultAuthMode(settings) {
    const everAuthenticated = localStorage.getItem('supabaseAccountEverCreated') === 'true';
    return (settings.userPhone && everAuthenticated) ? 'login' : 'signup';
}

function markSupabaseAccountEverCreated() {
    localStorage.setItem('supabaseAccountEverCreated', 'true');
}

// ---------- settings(userSettings) <-> profiles/vehicles/clients ----------

// settings 객체에서 cars/clients와 profiles의 전용 컬럼으로 이미 저장되는 필드를 뺀
// "나머지 토글/설정값 전부"를 profiles.settings(jsonb)에 통째로 넣기 위해 뽑아낸다.
function buildSettingsJsonbPayload(settings) {
    const {
        cars, clients,
        accountType, userName, userPhone,
        bizName, bizNumber, bizAddress, bizType, bizItem, bizEmail,
        bankName, accountNumber,
        ...rest
    } = settings || {};
    return rest;
}

function buildVehicleRow(userId, logId, car, index) {
    return {
        user_id: userId,
        legacy_log_id: logId,
        number: car.number || '',
        type: car.type === 'sub' ? 'sub' : 'main',
        tonnage: car.tonnage || '',
        display_order: index,
        comm_enabled: !!car.commEnabled,
        comm_type: car.commType || null,
        comm_value: car.commission != null ? String(car.commission) : null,
        settlement_mode: car.settlementMode || null,
        driver_link_id: car.driverLinkId || null,
        driver_name: car.driverName || null,
        driver_legal_name: car.personalInfo?.name || null,
        driver_business_number: car.personalInfo?.bizNumber || null,
        driver_bank_name: car.personalInfo?.bank || null,
        driver_account_number: car.personalInfo?.account || null,
        archived: !!car.archived,
        raw: car
    };
}

function buildClientRow(userId, client, index) {
    return {
        user_id: userId,
        legacy_client_id: client.id || null,
        company_name: client.companyName,
        manager_name: client.managerName || null,
        biz_number: client.bizNumber || null,
        phone: client.phone || null,
        tax_invoice_enabled: !!client.taxInvoiceEnabled,
        is_pinned: !!client.isPinned,
        comm_enabled: !!client.commEnabled,
        comm_type: client.commType || null,
        comm_value: client.commission != null ? String(client.commission) : null,
        fixed_monthly_on: !!client.fixedMonthlyOn,
        fixed_monthly_amount: client.fixedMonthlyAmount != null ? String(client.fixedMonthlyAmount) : null,
        payment_term: client.paymentTerm || null,
        payment_term_value: client.paymentTermValue || null,
        display_order: index,
        raw: client
    };
}

// localStorage의 userSettings를 "지금 이 순간의 최신 상태" 기준으로 부분 수정한다.
// (비동기 Supabase 응답이 돌아왔을 때, 그 사이 사용자가 다른 걸 바꿨어도 그 변경을 덮어쓰지 않기 위함)
function patchLocalSettings(mutator) {
    try {
        const current = JSON.parse(localStorage.getItem('userSettings') || '{}');
        const updated = mutator(current) || current;
        localStorage.setItem('userSettings', JSON.stringify(updated));
    } catch (error) {
        console.error('로컬 설정 패치 실패:', error);
    }
}

// 방금 Supabase에 새로 생성되어 supabaseId를 발급받은 차량/거래처를, 로컬에 아직
// supabaseId가 없는 동일 항목(legacy_log_id / companyName 기준)에 채워 넣는다.
function patchSupabaseIdsIntoLocalSettings(carsWithIds, clientsWithIds) {
    patchLocalSettings(current => {
        const currentCars = Array.isArray(current.cars) ? current.cars : [];
        currentCars.forEach(c => {
            if (c.supabaseId) return;
            const logId = c.type === 'sub' ? c.number : 'main';
            const match = (carsWithIds || []).find(source => (source.type === 'sub' ? source.number : 'main') === logId);
            if (match?.supabaseId) c.supabaseId = match.supabaseId;
        });
        const currentClients = Array.isArray(current.clients) ? current.clients : [];
        currentClients.forEach(c => {
            if (c.supabaseId) return;
            const match = (clientsWithIds || []).find(source => source.companyName === c.companyName);
            if (match?.supabaseId) c.supabaseId = match.supabaseId;
        });
        current.cars = currentCars;
        current.clients = currentClients;
        return current;
    });
}

// setUserSettings()가 호출될 때마다(디바운스되어) 실행되는 백그라운드 동기화.
// 항상 flush 시점의 최신 localStorage 값을 다시 읽어서 보내므로, 디바운스 구간에서
// 여러 번 호출돼도 마지막 상태 하나만 서버로 나간다.
function scheduleSupabaseSettingsSync() {
    if (typeof queueBackgroundSave !== 'function') return;
    queueBackgroundSave('supabase-settings-sync', () => syncSettingsToSupabase(getUserSettings()), 600);
}

async function syncSettingsToSupabase(settings) {
    const user = await getSupabaseUser();
    if (!user) return; // 로그인 전이면 동기화하지 않는다.

    try {
        await (await getSupabaseClient()).from('profiles').upsert({
            id: user.id,
            account_type: settings.accountType || null,
            name: settings.userName || null,
            phone: settings.userPhone || null,
            business_name: settings.bizName || null,
            business_number: settings.bizNumber || null,
            business_address: settings.bizAddress || null,
            business_type: settings.bizType || null,
            business_item: settings.bizItem || null,
            business_email: settings.bizEmail || null,
            bank_name: settings.bankName || null,
            account_number: settings.accountNumber || null,
            settings: buildSettingsJsonbPayload(settings),
            updated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('profiles 동기화 실패(settings jsonb 컬럼이 아직 없을 수 있음):', error);
    }

    const client = await getSupabaseClient();
    const cars = Array.isArray(settings.cars) ? settings.cars : [];
    for (let index = 0; index < cars.length; index++) {
        const car = cars[index];
        const logId = car.type === 'sub' ? (car.number || `sub_${index}`) : 'main';
        const row = buildVehicleRow(user.id, logId, car, index);
        try {
            if (car.supabaseId) {
                const { error } = await client.from('vehicles').update(row).eq('id', car.supabaseId);
                if (error) throw error;
            } else {
                const { data, error } = await client.from('vehicles').insert(row).select('id').single();
                if (error) throw error;
                car.supabaseId = data.id;
            }
        } catch (error) {
            console.error('vehicles 동기화 실패:', logId, error);
        }
    }

    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    for (let index = 0; index < clients.length; index++) {
        const c = clients[index];
        if (!c?.companyName) continue;
        const row = buildClientRow(user.id, c, index);
        try {
            if (c.supabaseId) {
                const { error } = await client.from('clients').update(row).eq('id', c.supabaseId);
                if (error) throw error;
            } else {
                const { data, error } = await client.from('clients').insert(row).select('id').single();
                if (error) throw error;
                c.supabaseId = data.id;
            }
        } catch (error) {
            console.error('clients 동기화 실패:', c.companyName, error);
        }
    }

    patchSupabaseIdsIntoLocalSettings(cars, clients);
}

// Supabase(profiles+vehicles+clients)에서 읽어와 기존 getUserSettings()가 반환하던 것과
// 동일한 모양으로 조립한 뒤 localStorage(userSettings)에 그대로 반영한다.
async function initSettingsFromSupabase(userId) {
    const client = await getSupabaseClient();
    const [{ data: profile, error: profileError }, { data: vehicles, error: vehiclesError }, { data: clientsRows, error: clientsError }] = await Promise.all([
        client.from('profiles').select('*').eq('id', userId).maybeSingle(),
        client.from('vehicles').select('*').eq('user_id', userId).order('display_order', { ascending: true }),
        client.from('clients').select('*').eq('user_id', userId).order('display_order', { ascending: true })
    ]);
    if (profileError) console.error('profiles 조회 실패:', profileError);
    if (vehiclesError) console.error('vehicles 조회 실패:', vehiclesError);
    if (clientsError) console.error('clients 조회 실패:', clientsError);

    const jsonbSettings = (profile && profile.settings && typeof profile.settings === 'object') ? profile.settings : {};

    const cars = (vehicles || []).map(row => ({
        ...(row.raw && typeof row.raw === 'object' ? row.raw : {}),
        number: row.number || '',
        type: row.type || 'main',
        tonnage: row.tonnage || '',
        supabaseId: row.id
    }));

    const clientsList = (clientsRows || []).map(row => ({
        ...(row.raw && typeof row.raw === 'object' ? row.raw : {}),
        companyName: row.company_name,
        id: row.legacy_client_id || row.id,
        supabaseId: row.id
    }));

    // 서버 목록으로 완전히 덮어쓰기 전에, 이 기기에 아직 supabaseId가 없는(=한 번도 서버에
    // 못 올라간) 차량/거래처가 있으면 그대로 살려서 합쳐준다. 그렇지 않으면 마이그레이션
    // 일부 실패, 방금 추가했지만 아직 백그라운드 동기화가 못 끝난 항목 등이 하이드레이션 한
    // 번에 조용히 사라져버릴 수 있다(실제로 재현해서 확인한 문제).
    const previousSettings = getUserSettings();
    const unsyncedLocalCars = (Array.isArray(previousSettings.cars) ? previousSettings.cars : []).filter(c => c && !c.supabaseId);
    const unsyncedLocalClients = (Array.isArray(previousSettings.clients) ? previousSettings.clients : []).filter(c => c && !c.supabaseId);

    const assembled = {
        ...jsonbSettings,
        accountType: profile?.account_type || jsonbSettings.accountType || '',
        userName: profile?.name || '',
        userPhone: profile?.phone || '',
        bizName: profile?.business_name || '',
        bizNumber: profile?.business_number || '',
        bizAddress: profile?.business_address || '',
        bizType: profile?.business_type || '',
        bizItem: profile?.business_item || '',
        bizEmail: profile?.business_email || '',
        bankName: profile?.bank_name || '',
        accountNumber: profile?.account_number || '',
        cars: [...cars, ...unsyncedLocalCars],
        clients: [...clientsList, ...unsyncedLocalClients],
        isLoggedIn: true
    };

    localStorage.setItem('userSettings', JSON.stringify(assembled));
    return assembled;
}

// ---------- workData(운행 기록) <-> daily_logs/transport_details/... ----------

function resolveVehicleIdForLogId(logId) {
    const settings = getUserSettings();
    const cars = Array.isArray(settings.cars) ? settings.cars : [];
    const car = logId === 'main'
        ? cars.find(c => c.type === 'main')
        : cars.find(c => c.type === 'sub' && c.number === logId);
    return car?.supabaseId || null;
}

// 하루치 기록(daily_logs 1건 + 하위 콜상세/정비/유류/기타 배열)을 통째로 업서트한다.
// 하위 레코드는 "그날의 daily_log_id에 속한 것 전부 삭제 후 현재 배열을 다시 삽입"하는
// 방식으로 맞춘다 — 로컬 배열 항목에 안정적인 서버 id가 없어 항목 단위로 매칭하는 것보다
// 훨씬 단순하고, 매 저장마다 실행돼도 항상 최종 상태로 수렴하므로 안전하다.
// clientIdByName: 선택적으로 미리 만들어둔 회사명→clients.id 맵을 넘길 수 있다. 마이그레이션
// 경로에서는 방금 새로 만든 거래처의 supabaseId가 아직 localStorage에 반영되기 전이라
// getUserSettings()로 다시 읽으면 누락되므로, 호출부가 최신 맵을 직접 넘겨줘야 한다.
// 넘기지 않으면(평소 저장 경로) localStorage 기준으로 스스로 만든다.
async function upsertDailyLogRecordToSupabase(client, userId, vehicleId, workDate, rawRecordInput, clientIdByName = null) {
    const rawRecord = rawRecordInput === 'off' ? { isOff: true } : rawRecordInput;
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) return;

    const { callDetails = [], maintItems = [], fuelItems = [], miscItems = [], ...dailyFields } = rawRecord;

    const { data, error } = await client.from('daily_logs').upsert({
        user_id: userId,
        vehicle_id: vehicleId,
        work_date: workDate,
        is_off: !!rawRecord.isOff,
        fixed_count: parseEntityNumber(rawRecord.fixedCount),
        pallet_count: parseEntityNumber(rawRecord.palletCount),
        raw: dailyFields
    }, { onConflict: 'vehicle_id,work_date' }).select('id').single();
    if (error) throw error;
    const dailyLogId = data.id;

    if (!clientIdByName) {
        const settings = getUserSettings();
        clientIdByName = new Map((settings.clients || []).filter(c => c.supabaseId).map(c => [c.companyName, c.supabaseId]));
    }

    await Promise.all([
        client.from('transport_details').delete().eq('daily_log_id', dailyLogId),
        client.from('maintenance_records').delete().eq('daily_log_id', dailyLogId),
        client.from('fuel_records').delete().eq('daily_log_id', dailyLogId),
        client.from('misc_expense_records').delete().eq('daily_log_id', dailyLogId)
    ]);

    const jobs = [];
    if (Array.isArray(callDetails) && callDetails.length) {
        jobs.push(client.from('transport_details').insert(callDetails.map((detail, index) => ({
            daily_log_id: dailyLogId, user_id: userId, vehicle_id: vehicleId,
            client_id: clientIdByName.get(detail?.client) || null,
            work_date: workDate, sequence: index,
            load_loc: detail?.loadLoc || null, unload_loc: detail?.unloadLoc || null,
            fare_amount: parseEntityNumber(detail?.fare), distance_km: parseEntityNumber(detail?.distanceKm),
            insurance_fee_amount: parseEntityNumber(detail?.insuranceFee), remarks: detail?.remarks || null,
            departure_time: detail?.departureTime || null, arrival_time: detail?.arrivalTime || null,
            receipt: detail?.receipt || null, start_odometer: detail?.startOdometer || null, end_odometer: detail?.endOdometer || null,
            vat_exempt: !!detail?.vatExempt, platform: detail?.platform || null, cargo_tonnage: detail?.cargoTonnage || null,
            payment_status: detail?.paymentStatus || '미수', payment_due_date: detail?.paymentDueDate || null,
            payments: Array.isArray(detail?.payments) ? detail.payments : [],
            commission_snapshot: detail?.commissionSnapshot || null,
            raw: detail
        }))));
    }
    if (Array.isArray(maintItems) && maintItems.length) {
        jobs.push(client.from('maintenance_records').insert(maintItems.map((item, index) => ({
            daily_log_id: dailyLogId, user_id: userId, vehicle_id: vehicleId, work_date: workDate, sequence: index,
            cost_amount: parseEntityNumber(item?.fare), mileage_km: parseEntityNumber(item?.mileage), raw: item
        }))));
    }
    if (Array.isArray(fuelItems) && fuelItems.length) {
        jobs.push(client.from('fuel_records').insert(fuelItems.map((item, index) => ({
            daily_log_id: dailyLogId, user_id: userId, vehicle_id: vehicleId, work_date: workDate, sequence: index,
            cost_amount: parseEntityNumber(item?.cost), subsidy_amount: parseEntityNumber(item?.subsidy),
            volume_liter: parseEntityNumber(item?.liter), mileage_km: parseEntityNumber(item?.mileage), raw: item
        }))));
    }
    if (Array.isArray(miscItems) && miscItems.length) {
        jobs.push(client.from('misc_expense_records').insert(miscItems.map((item, index) => ({
            daily_log_id: dailyLogId, user_id: userId, vehicle_id: vehicleId, work_date: workDate, sequence: index,
            cost_amount: parseEntityNumber(item?.fare), raw: item
        }))));
    }
    await Promise.all(jobs);
}

const __supabaseWorkDataSyncedSnapshot = {}; // logId -> { [date]: JSON문자열 } — 마지막으로 서버에 반영한 상태(이번 세션 한정 캐시)

function scheduleSupabaseWorkDataSync(logId) {
    if (typeof queueBackgroundSave !== 'function') return;
    queueBackgroundSave('supabase-workdata-sync-' + logId, () => {
        const key = logId === 'main' ? 'workData' : 'workData_' + logId;
        let freshData = {};
        try { freshData = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (error) { freshData = {}; }
        return syncWorkDataToSupabase(logId, freshData);
    }, 600);
}

async function syncWorkDataToSupabase(logId, data) {
    const user = await getSupabaseUser();
    if (!user) return;
    const vehicleId = resolveVehicleIdForLogId(logId);
    if (!vehicleId) return; // 이 차량이 아직 Supabase에 만들어지지 않음 — 다음 저장 때 다시 시도된다.

    // 실패한 날짜는 스냅샷에 "동기화 완료"로 표시하지 않는다 — 그래야 오프라인 등으로 이번
    // 저장이 실패해도, 다음 번 저장(다른 날짜를 고치는 저장이라도) 때 diff 비교에서 다시
    // 걸려서 재시도된다. 성공한 것만 스냅샷에 반영한다.
    const prevSnapshot = __supabaseWorkDataSyncedSnapshot[logId] || {};
    const nextSnapshot = { ...prevSnapshot };
    const changedDates = [];
    Object.keys(data).forEach(date => {
        const json = JSON.stringify(data[date]);
        if (prevSnapshot[date] !== json) changedDates.push(date);
    });
    Object.keys(prevSnapshot).forEach(date => {
        if (!(date in data)) changedDates.push(date);
    });
    if (!changedDates.length) return;

    const client = await getSupabaseClient();
    for (const date of changedDates) {
        try {
            if (!(date in data)) {
                await client.from('daily_logs').delete().eq('vehicle_id', vehicleId).eq('work_date', date);
                delete nextSnapshot[date];
            } else {
                await upsertDailyLogRecordToSupabase(client, user.id, vehicleId, date, data[date]);
                nextSnapshot[date] = JSON.stringify(data[date]);
            }
        } catch (error) {
            console.error('운행기록 Supabase 저장 실패:', logId, date, error);
        }
    }
    __supabaseWorkDataSyncedSnapshot[logId] = nextSnapshot;
}

// Supabase(daily_logs+하위 4개 테이블)에서 읽어와 기존 workData 객체(날짜를 키로 하는 형태)와
// 동일한 모양으로 조립한 뒤 localStorage(workData / workData_<logId>)에 그대로 반영한다.
async function initWorkDataFromSupabase(cars) {
    const client = await getSupabaseClient();
    for (const car of (cars || [])) {
        if (!car.supabaseId) continue;
        const logId = car.type === 'sub' ? car.number : 'main';
        const key = logId === 'main' ? 'workData' : 'workData_' + logId;
        try {
            const [dailyRes, transportRes, maintRes, fuelRes, miscRes] = await Promise.all([
                client.from('daily_logs').select('*').eq('vehicle_id', car.supabaseId),
                client.from('transport_details').select('*').eq('vehicle_id', car.supabaseId).order('sequence', { ascending: true }),
                client.from('maintenance_records').select('*').eq('vehicle_id', car.supabaseId).order('sequence', { ascending: true }),
                client.from('fuel_records').select('*').eq('vehicle_id', car.supabaseId).order('sequence', { ascending: true }),
                client.from('misc_expense_records').select('*').eq('vehicle_id', car.supabaseId).order('sequence', { ascending: true })
            ]);

            const byDate = {};
            (dailyRes.data || []).forEach(row => {
                byDate[row.work_date] = {
                    ...(row.raw && typeof row.raw === 'object' ? row.raw : {}),
                    isOff: !!row.is_off,
                    fixedCount: row.fixed_count || 0,
                    palletCount: row.pallet_count || 0,
                    callDetails: [], maintItems: [], fuelItems: [], miscItems: []
                };
            });
            (transportRes.data || []).forEach(row => { if (byDate[row.work_date]) byDate[row.work_date].callDetails.push(row.raw && typeof row.raw === 'object' ? row.raw : {}); });
            (maintRes.data || []).forEach(row => { if (byDate[row.work_date]) byDate[row.work_date].maintItems.push(row.raw && typeof row.raw === 'object' ? row.raw : {}); });
            (fuelRes.data || []).forEach(row => { if (byDate[row.work_date]) byDate[row.work_date].fuelItems.push(row.raw && typeof row.raw === 'object' ? row.raw : {}); });
            (miscRes.data || []).forEach(row => { if (byDate[row.work_date]) byDate[row.work_date].miscItems.push(row.raw && typeof row.raw === 'object' ? row.raw : {}); });

            localStorage.setItem(key, JSON.stringify(byDate));

            // 이번 세션의 동기화 스냅샷도 방금 받아온 서버 상태로 맞춰서, 로그인 직후 첫 저장 때
            // 불필요하게 전체 재업로드하지 않도록 한다.
            const snapshot = {};
            Object.keys(byDate).forEach(date => { snapshot[date] = JSON.stringify(byDate[date]); });
            __supabaseWorkDataSyncedSnapshot[logId] = snapshot;
        } catch (error) {
            console.error('운행기록 Supabase 로드 실패:', logId, error);
        }
    }
}

// ---------- 기존 로컬 데이터 1회 마이그레이션 ----------

// "마이그레이션이 필요한 로컬 데이터"란 아직 한 번도 Supabase에 올라간 적 없는(=supabaseId가
// 없는) 차량/거래처가 있다는 뜻이다. 단순히 cars/clients/workData가 "존재하기만" 하는지로
// 판단하면, 이미 정상적으로 동기화되어 supabaseId가 붙어있는 데이터를 가진 유저가 재로그인할
// 때마다(예: supabaseMigrationDone 플래그가 아직 안 세워진 경우) 마이그레이션이 매번 다시
// 돌면서 차량/거래처가 중복 생성되는 사고로 이어진다 — 실제로 이 문제가 발생해서 고쳤다.
function checkHasLocalLegacyData() {
    try {
        const settings = JSON.parse(localStorage.getItem('userSettings') || '{}');
        const cars = Array.isArray(settings.cars) ? settings.cars : [];
        const clients = Array.isArray(settings.clients) ? settings.clients : [];
        if (cars.some(c => c && !c.supabaseId)) return true;
        if (clients.some(c => c && !c.supabaseId)) return true;
    } catch (error) { /* ignore */ }
    return false;
}

// buildNormalizedEntitySnapshot()의 관계 매핑 방식(차량→일자기록→콜상세/정비/유류/기타)을
// 참고해서 실제로 Supabase에 적재하는 마이그레이션 함수. 기존 함수 자체는 재사용하지 않는다
// (그 함수는 로컬 정규화 스토어 용도로 별도 관리되는 함수라 그대로 재사용하면 책임이 섞인다).
async function migrateLocalDataToSupabase(userId) {
    const client = await getSupabaseClient();
    const settings = getUserSettings();
    let hadFailures = false; // 하나라도 실패하면 호출부가 "완료" 플래그를 세우지 않도록 알려준다

    try {
        await client.from('profiles').upsert({
            id: userId,
            account_type: settings.accountType || null,
            name: settings.userName || null,
            phone: settings.userPhone || null,
            business_name: settings.bizName || null,
            business_number: settings.bizNumber || null,
            business_address: settings.bizAddress || null,
            business_type: settings.bizType || null,
            business_item: settings.bizItem || null,
            business_email: settings.bizEmail || null,
            bank_name: settings.bankName || null,
            account_number: settings.accountNumber || null,
            settings: buildSettingsJsonbPayload(settings)
        });
    } catch (error) {
        console.error('[마이그레이션] profiles 업로드 실패(settings jsonb 컬럼이 아직 없을 수 있음):', error);
        hadFailures = true;
    }

    // 거래처 — 이미 supabaseId가 있는(=예전에 이미 동기화된) 항목은 update로, 없는 항목만
    // insert로 새로 만든다. (매번 무조건 insert하면 재시도/재실행 시 중복 생성으로 이어진다.)
    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    const clientIdByName = new Map();
    for (let index = 0; index < clients.length; index++) {
        const c = clients[index];
        if (!c?.companyName) continue;
        try {
            const row = buildClientRow(userId, c, index);
            if (c.supabaseId) {
                const { error } = await client.from('clients').update(row).eq('id', c.supabaseId);
                if (error) throw error;
                clientIdByName.set(c.companyName, c.supabaseId);
            } else {
                const { data, error } = await client.from('clients').insert(row).select('id').single();
                if (error) throw error;
                c.supabaseId = data.id;
                clientIdByName.set(c.companyName, data.id);
            }
        } catch (error) {
            console.error('[마이그레이션] 거래처 업로드 실패:', c.companyName, error);
            hadFailures = true;
        }
    }

    // 차량 + 그 차량의 운행 기록 전체 — 거래처와 동일하게 supabaseId 유무에 따라 update/insert.
    const vehicleSources = getNormalizedVehicleSources(settings); // 로컬 저장소 열거 로직 자체는 기존 헬퍼를 그대로 재사용(구조 변형이 아니라 순수 열거라 안전)
    const vehicleIdByLogId = new Map();
    const vehicleIdByNumber = new Map();
    for (let index = 0; index < vehicleSources.length; index++) {
        const { logId, car, storageKey } = vehicleSources[index];
        let vehicleId = null;
        try {
            const row = buildVehicleRow(userId, logId, car, index);
            if (car.supabaseId) {
                const { error } = await client.from('vehicles').update(row).eq('id', car.supabaseId);
                if (error) throw error;
                vehicleId = car.supabaseId;
            } else {
                const { data, error } = await client.from('vehicles').insert(row).select('id').single();
                if (error) throw error;
                vehicleId = data.id;
                car.supabaseId = vehicleId;
            }
            vehicleIdByLogId.set(logId, vehicleId);
            if (car.number) vehicleIdByNumber.set(car.number, vehicleId);
        } catch (error) {
            console.error('[마이그레이션] 차량 업로드 실패:', logId, error);
            hadFailures = true;
            continue;
        }

        const sourceData = readWorkDataStorage(storageKey);
        for (const workDate of Object.keys(sourceData)) {
            try {
                // clientIdByName을 명시적으로 넘긴다 — 이 시점엔 방금 만든 거래처의 supabaseId가
                // 아직 localStorage에 반영되기 전이라, 안 넘기면 콜상세의 client_id가 전부 null로
                // 빠지는 문제가 있었다(실제로 재현해서 확인).
                await upsertDailyLogRecordToSupabase(client, userId, vehicleId, workDate, sourceData[workDate], clientIdByName);
            } catch (error) {
                console.error('[마이그레이션] 운행기록 업로드 실패:', logId, workDate, error);
                hadFailures = true;
            }
        }
    }

    // 세금계산서
    const taxRecords = getTaxInvoiceRecords();
    for (const invoice of taxRecords) {
        try {
            await client.from('tax_invoices').insert({
                user_id: userId,
                vehicle_id: vehicleIdByNumber.get(invoice.carNumber) || vehicleIdByLogId.get(invoice.carNumber) || null,
                client_id: clientIdByName.get(invoice.clientName) || null,
                flow: invoice.flow || null,
                month_key: invoice.monthKey || null,
                supply_amount: parseEntityNumber(invoice.supplyAmount),
                tax_amount: parseEntityNumber(invoice.taxAmount),
                total_amount: parseEntityNumber(invoice.totalAmount),
                status: invoice.status || 'draft',
                raw: invoice
            });
        } catch (error) {
            console.error('[마이그레이션] 세금계산서 업로드 실패:', invoice, error);
            hadFailures = true;
        }
    }

    // 방금 발급받은 supabaseId들을 로컬에도 반영(다음 hydrate 전까지도 최신 상태 유지)
    patchSupabaseIdsIntoLocalSettings(vehicleSources.map(v => v.car), clients);

    return { hadFailures };
}

// ---------- 로그인 성공 직후 실행되는 전체 orchestration ----------

// completeLocalLogin()과 앱 부팅(세션 복원) 양쪽에서 공통으로 호출한다.
// 1) (기존 로컬 데이터가 있고 아직 마이그레이션 전이면) 로컬 → Supabase 1회 업로드
// 2) Supabase → 로컬(localStorage) 최신화
// 3) 화면 다시 그리기
async function hydrateFromSupabaseAndMigrate() {
    const user = await getSupabaseUser();
    if (!user) return;

    if (checkHasLocalLegacyData() && !localStorage.getItem('supabaseMigrationDone')) {
        try {
            const { hadFailures } = await migrateLocalDataToSupabase(user.id);
            if (hadFailures) {
                // 일부 항목만 실패해도 플래그를 세우지 않는다 — 세워버리면 실패한 항목은
                // 다시는 마이그레이션 대상으로 재검토되지 않는다. supabaseId가 없는 항목은
                // 어차피 insert-or-update 로직상 재실행해도 중복이 생기지 않으므로 안전하다.
                console.warn('[Supabase] 로컬 데이터 마이그레이션 일부 실패 — 다음 로그인 때 나머지를 재시도합니다.');
            } else {
                localStorage.setItem('supabaseMigrationDone', 'true');
                console.log('[Supabase] 기존 로컬 데이터 마이그레이션 완료');
            }
        } catch (error) {
            // 실패해도 로컬 데이터는 그대로 보존된다(삭제/덮어쓰기 없음). 플래그를 세우지 않으므로
            // 다음 로그인 때 다시 시도한다.
            console.error('[Supabase] 로컬 데이터 마이그레이션 실패 — 로컬 데이터는 보존되며 다음 로그인 때 재시도합니다.', error);
        }
    }

    const settings = await initSettingsFromSupabase(user.id);
    await initWorkDataFromSupabase(settings.cars || []);

    // 지금 화면에 보이는 로그(activeLogId)를 새로 불러온 데이터로 갱신
    if (typeof loadWorkDataForLog === 'function') {
        workData = loadWorkDataForLog(typeof activeLogId !== 'undefined' ? activeLogId : 'main');
    }
    if (typeof normalizeLegacyData === 'function') normalizeLegacyData();
    if (typeof loadSettings === 'function') loadSettings();
    if (typeof buildCalendar === 'function') buildCalendar();
    if (typeof renderSubCarMenu === 'function') renderSubCarMenu();
    if (typeof updateAccountRoleUI === 'function') updateAccountRoleUI();
}
