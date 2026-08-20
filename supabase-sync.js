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
        const profilePayload = {
            id: user.id,
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
        };
        // account_type은 회원가입 시 한 번 정해지는 계정 정체성 값이라(개인정보 화면에 직접
        // 지우는 UI가 없음), 로컬 settings.accountType이 일시적으로 비어 있는 상태(하이드레이션
        // 완료 전 등)에서 이 함수가 실행되더라도 서버 값을 null로 덮어쓰지 않는다. 값이 있을
        // 때만 payload에 넣어서, upsert가 이 컬럼은 아예 건드리지 않게 한다 — 한 번 null로
        // 덮이면 다음 로그인부터 계속 빈 값을 읽어와 다시 null로 저장하는 자기강화형 버그였다.
        if (settings.accountType) profilePayload.account_type = settings.accountType;

        await (await getSupabaseClient()).from('profiles').upsert(profilePayload);
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

// 특정 차량의 "실제 사용해야 할" 사업자정보를 서버 기준으로 판단한다. 차주의 개인정보
// 기본 사업자(profiles.business_*)와 차량별 사업자(vehicles.raw.businessInfo)는 서로 다른
// 개념이다 — 차량이 sameAsOwner면 차주 기본 사업자를, 아니면 그 차량 고유의 사업자정보를
// 반환한다(getCarBusinessInfo()의 서버 조회 버전). 기사 개인정보 자동반영(applyEmployerAutoFilledInfo)이
// 이 함수 하나로 통일해서 쓴다 — 여러 화면에서 사업자정보 판단 로직이 제각각 흩어지지
// 않게 하기 위함.
async function resolveVehicleBusinessInfoFromSupabase(client, vehicleId, ownerId) {
    const [{ data: ownerProfile }, vehicleResult] = await Promise.all([
        client.from('profiles').select('name, business_name, business_number, business_address, business_type, business_item, business_email').eq('id', ownerId).maybeSingle(),
        vehicleId ? client.from('vehicles').select('id, number, tonnage, raw').eq('id', vehicleId).maybeSingle() : Promise.resolve({ data: null })
    ]);

    const ownerBiz = {
        name: ownerProfile?.business_name || '',
        bizNumber: ownerProfile?.business_number || '',
        representative: ownerProfile?.name || '',
        address: ownerProfile?.business_address || '',
        bizType: ownerProfile?.business_type || '',
        bizItem: ownerProfile?.business_item || '',
        email: ownerProfile?.business_email || ''
    };

    const vehicleRow = vehicleResult?.data || null;
    // vehicles.raw는 차량 관리 모달이 저장한 car 객체 원본이다(§10에서 확인한 실제 저장
    // 위치) — 별도 business_info 컬럼은 없고, 이 raw.businessInfo가 유일한 저장소다.
    const vehicleBusinessInfo = vehicleRow?.raw?.businessInfo || null;
    const sameAsOwner = !vehicleBusinessInfo || vehicleBusinessInfo.sameAsOwner !== false;
    const biz = sameAsOwner ? ownerBiz : {
        name: vehicleBusinessInfo.name || '',
        bizNumber: vehicleBusinessInfo.bizNumber || '',
        representative: vehicleBusinessInfo.representative || '',
        address: vehicleBusinessInfo.address || '',
        bizType: vehicleBusinessInfo.bizType || '',
        bizItem: vehicleBusinessInfo.bizItem || '',
        email: vehicleBusinessInfo.email || ''
    };

    return { biz, sameAsOwner, vehicleRow };
}

// 차량 관리 모달의 "기사 연동하기" 버튼 전용. queueBackgroundSave의 600ms 디바운스를 기다리지
// 않고 이 차량 "하나만" 즉시 Supabase에 반영해서 실제 vehicle_id를 확보한다 — 기사 초대
// (driver_links)는 실제 vehicle_id가 있어야만 만들 수 있는데, 디바운스를 기다리면 그 사이
// "차량이 아직 클라우드에 동기화되지 않았다"는 오류로 이어지거나, 사용자가 몇 초씩 기다리는
// 어색한 흐름이 된다. car 객체를 직접 변형해서(car.supabaseId = ...) 호출부가 즉시 쓸 수
// 있게 하고, 성공한 id를 반환한다. 실패하면 예외를 던진다(호출부가 안내).
async function ensureVehicleSyncedToSupabase(car, index) {
    const user = await getSupabaseUser();
    if (!user) throw new Error('로그인이 필요합니다.');
    const client = await getSupabaseClient();
    const logId = car.type === 'sub' ? (car.number || `sub_${index}`) : 'main';
    const row = buildVehicleRow(user.id, logId, car, index);
    if (car.supabaseId) {
        const { error } = await client.from('vehicles').update(row).eq('id', car.supabaseId);
        if (error) throw error;
        return car.supabaseId;
    }
    const { data, error } = await client.from('vehicles').insert(row).select('id').single();
    if (error) throw error;
    car.supabaseId = data.id;
    return data.id;
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
    const previousCars = Array.isArray(previousSettings.cars) ? previousSettings.cars : [];
    const previousClients = Array.isArray(previousSettings.clients) ? previousSettings.clients : [];
    const unsyncedLocalCars = previousCars.filter(c => c && !c.supabaseId);
    const unsyncedLocalClients = previousClients.filter(c => c && !c.supabaseId);

    // 안전장치: 이 기기에 이미 "서버에 실제로 동기화됐던" 차량/거래처(supabaseId 있음)가
    // 있는데, 이번 조회에서 서버가 vehicles/clients를 0건(또는 에러)으로 반환했다면 — 이건
    // 거의 항상 "차주가 전부 실제로 지웠다"가 아니라 네트워크 문제 등 일시적 조회 실패다.
    // 그런 응답을 그대로 믿고 로컬 목록을 통째로 비우면 안 되므로, 그 경우엔 서버 결과를
    // 신뢰하지 않고 이 기기의 기존 목록을 그대로 유지한다(실제 삭제는 deleteCar/deleteClient가
    // 이미 이 기기 로컬에도 즉시 반영해 두므로, 정상적인 삭제까지 막지는 않는다).
    const previousSyncedCars = previousCars.filter(c => c && c.supabaseId);
    const previousSyncedClients = previousClients.filter(c => c && c.supabaseId);
    const carsLookSuspiciouslyEmpty = vehiclesError || (cars.length === 0 && previousSyncedCars.length > 0);
    const clientsLookSuspiciouslyEmpty = clientsError || (clientsList.length === 0 && previousSyncedClients.length > 0);
    if (carsLookSuspiciouslyEmpty) console.warn('[Supabase] vehicles 조회가 비정상적으로 비어 있어 로컬 차량 목록을 그대로 유지합니다.');
    if (clientsLookSuspiciouslyEmpty) console.warn('[Supabase] clients 조회가 비정상적으로 비어 있어 로컬 거래처 목록을 그대로 유지합니다.');

    // 위에서 살려둔 "아직 안 올라간" 항목이 사실은 서버에 이미 올라간 것과 같은 차량/거래처일
    // 수 있다(예: 방금 동기화가 끝났는데 로컬 supabaseId 반영이 이 하이드레이션보다 아주
    // 살짝 늦게 붙는 경우). 그대로 합치면 화면에 같은 차량이 두 번 보이는 문제로 이어지므로,
    // 합친 뒤 반드시 한 번 더 정리한다(메인 차량은 최대 1대, 기사차량은 번호 기준 — 실제로
    // 이 경합으로 중복이 생기는 걸 재현해서 이 정리 로직을 추가했다).
    const mergedCars = carsLookSuspiciouslyEmpty ? previousCars : [...cars, ...unsyncedLocalCars];
    const mergedClients = clientsLookSuspiciouslyEmpty ? previousClients : [...clientsList, ...unsyncedLocalClients];
    const dedupedCars = typeof dedupeCars === 'function' ? dedupeCars(mergedCars).cars : mergedCars;
    const dedupedClients = typeof dedupeClients === 'function' ? dedupeClients(mergedClients).clients : mergedClients;

    const assembled = {
        ...jsonbSettings,
        // 서버 profile.account_type이 비어 있는(레이스 등으로 순간적으로 null인) 경우에도,
        // 이 기기에 이미 캐싱돼 있던 이전 로컬 accountType이 있으면 그걸 마지막 보루로 쓴다 —
        // 그래야 진짜 신규 유저(둘 다 없음)만 ''가 되고, 기존 유저는 accountType이 실수로
        // 지워지지 않는다.
        accountType: profile?.account_type || jsonbSettings.accountType || previousSettings.accountType || '',
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
        cars: dedupedCars,
        clients: dedupedClients,
        isLoggedIn: true
    };

    localStorage.setItem('userSettings', JSON.stringify(assembled));
    return assembled;
}

// ---------- workData(운행 기록) <-> daily_logs/transport_details/... ----------

// 소속 기사가 차주와 연동돼 있으면 'main' 로그의 운행기록은 기사 본인의 별도 vehicles
// 행이 아니라 차주가 실제로 소유한 vehicle_id로 저장돼야 한다 — 그래야 차주가 자기
// 차량 기준으로 그 기록을 조회할 수 있다(daily_logs/transport_details의 RLS는 vehicle_id를
// 통해 "그 차량을 소유한 차주"에게 조회를 허용하지, user_id로 직접 허용하지 않는다).
// 안 그러면 기사 본인 소유의(연동과 무관한) 별도 vehicles 행에 기록이 쌓여서 차주가 영원히
// 못 보는 문제가 있었다(실제로 재현해서 확인).
function resolveVehicleIdForLogId(logId) {
    const settings = getUserSettings();
    if (logId === 'main' && settings.accountType === 'employed_driver' && settings.employerLink?.status === 'linked' && settings.employerLink?.vehicleId) {
        return settings.employerLink.vehicleId;
    }
    const cars = Array.isArray(settings.cars) ? settings.cars : [];
    const car = logId === 'main'
        ? cars.find(c => c.type === 'main')
        : cars.find(c => c.type === 'sub' && c.number === logId);
    return car?.supabaseId || null;
}

// 소속 기사가 차주와 "방금" 연동됐을 때, 그 이전에 이미 이 기기에 기록해둔 과거 운행기록
// (오늘 이전 것 포함)을 전부 차주가 소유한 vehicle_id로 다시 업로드한다. 연동 전에 저장된
// 기록은 그 시점의 vehicle_id(기사 본인 소유의 별도 차량 행, 또는 아직 연동 전이라 로컬만)를
// 그대로 가지고 있어서, 연동 이후 것만 자동으로 차주 쪽에서 보이고 과거 기록은 계속 안
// 보이는 문제가 있었다 — 그래서 연동 시점에 한 번 전체를 다시 밀어 넣는다. 매번 로그인할
// 때마다 돌리기엔 무거우니(기록이 많으면 매번 전부 재업로드) 연동 직후 1회, 그리고 필요하면
// 사용자가 "과거 기록 다시 동기화" 버튼으로 수동 재실행한다.
async function backfillDriverWorkDataToOwnerVehicle(vehicleId) {
    if (!vehicleId) return { count: 0, failed: 0 };
    const user = await getSupabaseUser();
    if (!user) return { count: 0, failed: 0 };

    const client = await getSupabaseClient();
    let data = {};
    try {
        data = JSON.parse(localStorage.getItem('workData') || '{}') || {};
    } catch (error) {
        data = {};
    }

    const dates = Object.keys(data).sort();
    let count = 0;
    let failed = 0;
    for (const date of dates) {
        try {
            await upsertDailyLogRecordToSupabase(client, user.id, vehicleId, date, data[date]);
            count++;
        } catch (error) {
            failed++;
            console.error('과거 운행기록 재업로드 실패:', date, error);
        }
    }

    // 차주 쪽 "기록 조회" 화면은 driver_links.assignment_start~assignment_end 기간 안의
    // 날짜만 보여준다(isDateWithinAssignment). 초대를 처음 만들 때 할당 시작일은 보통
    // "오늘"로 잡히는데, 방금 백필한 과거 기록은 그보다 이른 날짜라서 실제로 DB에는
    // 있어도 기록 조회 화면에서는 필터링돼 안 보이는 문제가 있었다(월매출 등 다른 집계는
    // 이 필터를 안 써서 정상으로 보였음 — 실제로 재현해서 확인). 백필한 기록 중 가장 이른
    // 날짜가 지금 할당 시작일보다 이르면 할당 시작일을 그 날짜로 앞당긴다.
    const earliestDate = dates[0];
    if (earliestDate && count > 0) {
        try {
            const settings = getUserSettings();
            const linkSupabaseId = settings.employerLink?.supabaseId;
            if (linkSupabaseId) {
                const { data: linkRow } = await client.from('driver_links').select('assignment_start').eq('id', linkSupabaseId).maybeSingle();
                if (linkRow?.assignment_start && earliestDate < linkRow.assignment_start) {
                    await client.from('driver_links').update({ assignment_start: earliestDate, updated_at: new Date().toISOString() }).eq('id', linkSupabaseId);
                }
            }
        } catch (error) {
            console.error('할당 시작일 보정 실패(운행기록 자체는 반영됨):', error);
        }
    }

    return { count, failed };
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
        const logId = car.type === 'sub' ? car.number : 'main';
        // car.supabaseId를 그대로 쓰면 안 된다 — 연동된 소속기사의 'main' 로그는 본인 소유의
        // (별도) vehicles 행이 아니라 차주가 소유한 vehicle_id에 실제 기록이 저장된다
        // (resolveVehicleIdForLogId, 저장 경로에서 이미 쓰고 있는 것과 동일한 규칙). 이 함수가
        // 여기서 car.supabaseId만 보고 있으면, 연동된 기사가 새 기기/재로그인할 때마다 본인의
        // (기록이 없는) 별도 차량 행을 조회해서 로컬 workData를 빈 값으로 덮어써 버리는 문제가
        // 있었다 — 실제로 재현해서 확인하고 고쳤다.
        const vehicleId = typeof resolveVehicleIdForLogId === 'function' ? resolveVehicleIdForLogId(logId) : car.supabaseId;
        if (!vehicleId) continue;
        const key = logId === 'main' ? 'workData' : 'workData_' + logId;
        try {
            const [dailyRes, transportRes, maintRes, fuelRes, miscRes] = await Promise.all([
                client.from('daily_logs').select('*').eq('vehicle_id', vehicleId),
                client.from('transport_details').select('*').eq('vehicle_id', vehicleId).order('sequence', { ascending: true }),
                client.from('maintenance_records').select('*').eq('vehicle_id', vehicleId).order('sequence', { ascending: true }),
                client.from('fuel_records').select('*').eq('vehicle_id', vehicleId).order('sequence', { ascending: true }),
                client.from('misc_expense_records').select('*').eq('vehicle_id', vehicleId).order('sequence', { ascending: true })
            ]);
            if (dailyRes.error) throw dailyRes.error;

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

            // 서버 응답으로 완전히 덮어쓰지 않고, 날짜 단위로 "로컬 위에 서버를 얹는" 방식으로
            // 합친다. 서버가 가진 날짜는 서버 값이 우선(정상 케이스)이지만, 서버 응답에 없는
            // 날짜(아직 배경 동기화 큐에 남아있는 최근 입력분 등)는 로컬 값을 그대로 보존한다.
            // 예전에는 매번 localStorage.setItem(key, JSON.stringify(byDate))로 통째로 덮어써서,
            // 쿼리가 일시적으로 빈 배열을 반환하면(네트워크 문제 등, 명시적 에러 없이도 발생 가능)
            // 로컬에 이미 있던 운행기록이 통째로 사라지는 문제가 있었다.
            let localExisting = {};
            try {
                localExisting = JSON.parse(localStorage.getItem(key) || '{}') || {};
            } catch (error) {
                localExisting = {};
            }
            const mergedByDate = { ...localExisting, ...byDate };

            localStorage.setItem(key, JSON.stringify(mergedByDate));

            // 이번 세션의 동기화 스냅샷도 방금 받아온 서버 상태로 맞춰서, 로그인 직후 첫 저장 때
            // 불필요하게 전체 재업로드하지 않도록 한다.
            const snapshot = {};
            Object.keys(mergedByDate).forEach(date => { snapshot[date] = JSON.stringify(mergedByDate[date]); });
            __supabaseWorkDataSyncedSnapshot[logId] = snapshot;
        } catch (error) {
            console.error('운행기록 Supabase 로드 실패(기존 로컬 데이터 보존):', logId, error);
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

    let settings = await initSettingsFromSupabase(user.id);

    // 기사연동 상태 복원은 반드시 운행기록(initWorkDataFromSupabase)보다 먼저 끝내야 한다.
    // 연동된 소속기사의 'main' 로그는 resolveVehicleIdForLogId()가 employerLink.vehicleId를
    // 봐서 조회 대상을 정하는데, 이 값이 아직 로컬에 복원되기 전(특히 새 기기 첫 로그인처럼
    // employerLink 캐시 자체가 없는 경우)에 initWorkDataFromSupabase가 먼저 돌면 대상
    // vehicle_id를 못 찾아 건너뛰고, 그 결과 기사 앱에 운행일지가 0건으로 보이는 문제가
    // 있었다(실제로 재현되는 순서 문제였다). 그래서 이 블록을 먼저 실행한다.
    //
    // 차주 계정이면 기사 연동 목록도 로그인 시점에 서버 기준으로 갱신해 둔다.
    // 이걸 안 하면 settings.driverLinks가 예전 캐시(연동 전 상태 등)에 머물러 있어서,
    // 로그인 직후 햄버거 메뉴에 "OOOO 관리"(연동 기사 바로가기) 항목이 빠져 보이고,
    // "기사 연동 관리" 화면을 한 번 들어갔다 나와야만(그 화면이 자체적으로 동기화하므로) 나타나는
    // 문제가 있었다.
    if (typeof isOwnerAccountType === 'function' && isOwnerAccountType(settings.accountType) && typeof syncDriverLinksFromSupabase === 'function') {
        try {
            await syncDriverLinksFromSupabase();
        } catch (error) {
            console.error('[Supabase] 로그인 시 기사 연동 목록 갱신 실패(기존 캐시로 계속 진행):', error);
        }
    } else if (settings.accountType === 'employed_driver' && typeof syncEmployerLinkFromSupabase === 'function') {
        // 소속 기사는 로그인/새 기기 진입 시마다 서버의 실제 연결 상태(driver_links)로
        // employerLink를 복원한다. 로컬에 없다고 새로 만들지 않고, 서버에 없으면 비운다 —
        // "기존 연결이 있으면 초대코드 없이 그대로 복원되고, 연결이 없으면 로그인은 성공하되
        // 미연결 상태로 진입한다"는 요구사항의 핵심 지점.
        try {
            await syncEmployerLinkFromSupabase();
            // 로그인/새로고침 시점에도 연결된 차량의 최신 사업자정보(+ 차량번호/톤수)를 함께
            // 반영한다. 이걸 개인정보 화면 진입 시에만 하면, 로그인 직후 메인 화면 등 다른
            // 곳에 머무는 동안은 여전히 예전 사업자정보가 남아있게 된다.
            const refreshedSettings = getUserSettings();
            const link = refreshedSettings.employerLink;
            if (link?.status === 'linked' && link.ownerId && typeof applyEmployerAutoFilledInfo === 'function') {
                await applyEmployerAutoFilledInfo(link.ownerId, link.vehicleId);
            }
        } catch (error) {
            console.error('[Supabase] 로그인 시 기사 연동 상태/사업자정보 갱신 실패(기존 캐시로 계속 진행):', error);
        }
    }

    // employerLink 복원(및 그에 따른 mainCar 자동입력)이 방금 settings.cars를 바꿨을 수 있으니
    // 최신 상태로 다시 읽어서 운행기록을 불러온다.
    settings = getUserSettings();
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

// script.js의 importData()가 백업 파일을 복원한 직후 호출한다. restoreBackupStorage()는
// localStorage에 직접 쓰기 때문에 평소의 setUserSettings()/saveWorkDataForLog() 경로를
// 거치지 않아 Supabase에는 전혀 반영되지 않는다 — 그 상태로 두면:
//   1) 다음 로그인/새로고침 때 하이드레이션이 서버의 예전 데이터로 방금 불러온 백업을
//      덮어써서 조용히 사라지고,
//   2) 그 전에 설정을 하나라도 바꾸면 supabaseId 없는 차량/거래처가 전부 "새 항목"으로
//      insert되어 중복이 생긴다(차량 관리 모달에서 실제로 재현됐던 것과 같은 종류의 버그).
// 그래서 백업을 불러온 뒤에는 반드시 이 함수로 서버에도 실제로 반영해야 한다.
async function syncImportedBackupToSupabase() {
    const user = await getSupabaseUser();
    if (!user) return; // 로그인 상태가 아니면 로컬 백업만으로 충분(기존 동작과 동일)

    // 백업 파일 속 supabaseId는 이 계정·이 시점과 무관할 수 있다(다른 기기/다른 시점에
    // 만든 백업일 수 있음) — 그대로 재사용하면 이미 사라졌거나 다른 데이터를 가리키는
    // uuid를 참조하게 될 위험이 있어, 전부 지우고 깨끗하게 새로 동기화되게 한다.
    const settings = getUserSettings();
    (settings.cars || []).forEach(c => { if (c) delete c.supabaseId; });
    (settings.clients || []).forEach(c => { if (c) delete c.supabaseId; });
    localStorage.setItem('userSettings', JSON.stringify(settings));
    localStorage.removeItem('supabaseMigrationDone');

    await hydrateFromSupabaseAndMigrate();
}

// ============================================================================
// 기사 연동(driver_links) — 차주-기사차량 초대 코드 연결
// ============================================================================
// script.js의 "기사 연동 관리"(차주 쪽)와 "소속 연결"(기사 쪽) 화면은 원래 한 브라우저
// 안에서만 동작하는 시뮬레이션(로컬 driverLinks 배열 + employerLink 객체)이었다. 여기서는
// 그 둘을 실제 Supabase driver_links 테이블로 이어준다. UI/로컬 캐시 모양은 최대한 그대로
// 유지하고, "실제로 서버에 반영됐는가"가 중요한 지점(초대 생성, 코드 연결)만 반드시
// await해서 실패를 사용자에게 알린다. 상태 변경(해제 등)은 다른 저장 로직처럼 로컬 우선 +
// 백그라운드 동기화로 처리한다.

function getDriverLinkErrorMessage(error) {
    // redeem_driver_invite_code()의 RAISE EXCEPTION 메시지는 한글로 그대로 내려오므로
    // 우선 사용하고, 그 외(네트워크 등)는 기존 공용 메시지 헬퍼로 폴백한다.
    return error?.message || (typeof getSaveErrorMessage === 'function' ? getSaveErrorMessage(error) : '처리 중 오류가 발생했습니다.');
}

// 같은 차량에 할당 기간이 겹치는 "연동 해제되지 않은" 다른 초대/연결이 있는지 서버 기준으로
// 확인한다. script.js의 assignmentRangesOverlap()을 그대로 재사용한다(로컬 오버랩 판정 공식은
// 이미 검증된 로직이라 새로 만들지 않는다).
async function findOverlappingDriverLinkOnSupabase(vehicleId, start, end, excludeSupabaseId) {
    const client = await getSupabaseClient();
    const { data, error } = await client
        .from('driver_links')
        .select('id, assignment_start, assignment_end, status, driver_id')
        .eq('vehicle_id', vehicleId)
        .neq('status', 'disconnected');
    if (error) throw error;

    return (data || []).find(row => {
        if (excludeSupabaseId && row.id === excludeSupabaseId) return false;
        if (!row.assignment_start) return false;
        return typeof assignmentRangesOverlap === 'function'
            ? assignmentRangesOverlap(start, end || '', row.assignment_start, row.assignment_end || '')
            : false;
    }) || null;
}

// 초대를 새로 만들거나(기존 supabaseId 없음) 이미 있는 초대를 수정한다(있음).
// 신규 생성 시 invite_code가 다른 pending 초대와 충돌하면(23505) 코드를 새로 뽑아 재시도한다.
// 수정 시에는 update 대상에 status를 아예 넣지 않는다 — supabase-js의 update()는 넘긴
// 컬럼만 SET하므로, status를 빼면 pending/linked 어느 쪽이든 지금 값 그대로 유지된다.
async function upsertDriverLinkOnSupabase({ supabaseId, vehicleId, inviteCode, assignmentStart, assignmentEnd }) {
    const client = await getSupabaseClient();
    const user = await getSupabaseUser();
    if (!user) throw new Error('로그인이 필요합니다.');

    const baseRow = {
        owner_id: user.id,
        vehicle_id: vehicleId,
        assignment_start: assignmentStart,
        assignment_end: assignmentEnd || null,
        updated_at: new Date().toISOString()
    };

    if (supabaseId) {
        const row = { ...baseRow, invite_code: inviteCode };
        const { data, error } = await client.from('driver_links').update(row).eq('id', supabaseId).select().single();
        if (error) throw error;
        return data;
    }

    let code = inviteCode;
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await client
            .from('driver_links')
            .insert({ ...baseRow, invite_code: code, status: 'pending' })
            .select()
            .single();
        if (!error) return data;
        // 23505 = unique_violation. pending 코드가 이미 다른 초대에서 쓰이는 중이면 새로 뽑아 재시도.
        if (error.code === '23505') {
            lastError = error;
            code = String(Math.floor(100000 + Math.random() * 900000));
            continue;
        }
        throw error;
    }
    throw lastError || new Error('초대 코드 생성에 반복적으로 실패했습니다.');
}

async function updateDriverLinkStatusOnSupabase(supabaseId, status) {
    if (!supabaseId) return;
    const client = await getSupabaseClient();
    const row = { status, updated_at: new Date().toISOString() };
    const { error } = await client.from('driver_links').update(row).eq('id', supabaseId);
    if (error) throw error;
}

async function deleteDriverLinkOnSupabase(supabaseId) {
    if (!supabaseId) return;
    const client = await getSupabaseClient();
    const { error } = await client.from('driver_links').delete().eq('id', supabaseId);
    if (error) throw error;
}

// 차주 화면(기사 연동 관리)을 열 때 서버 기준으로 로컬 driverLinks 캐시를 새로 맞춘다.
// 특히 "기사가 코드를 입력해서 연결했는지"는 오직 서버에서만 알 수 있으므로, 이 동기화가
// 곧 "연결 완료 여부 확인" 역할을 한다.
// syncDriverLinksFromSupabase()의 "기사(driver)" 쪽 대응 함수. 소속 기사 계정이 로그인/
// 하이드레이션될 때 서버의 실제 driver_links를 조회해서 employerLink 캐시를 복원한다.
// 이게 없으면 (a) 새 기기/새 브라우저에서 로그인했을 때 로컬에 employerLink가 없다는
// 이유만으로 "연결 안 됨"으로 잘못 표시되거나, (b) 반대로 로그인 처리 코드가 화면의
// 초대코드 입력값만 보고 임의로 status:'linked'를 만들어 넣어(과거 버그) 실제로는 연결된
// 적 없는데도 연결된 것처럼 보이는 문제가 생긴다. 반드시 서버 데이터를 기준으로 판단한다.
async function syncEmployerLinkFromSupabase() {
    const user = await getSupabaseUser();
    if (!user) return;
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client
            .from('driver_links')
            .select('*')
            .eq('driver_id', user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;

        const settings = getUserSettings();
        const latest = (data || [])[0] || null;

        if (!latest || latest.status !== 'linked') {
            // 서버에 유효한(linked) 연결이 없다 — 로컬에도 가짜 연결 상태를 남겨두지 않는다.
            // "연결 안 됨"과 "로그인 안 됨"은 별개이므로, 여기서는 employerLink만 비우고
            // 로그인 자체(isLoggedIn 등)에는 손대지 않는다.
            settings.employerLink = null;
            localStorage.setItem('userSettings', JSON.stringify(settings));
            return;
        }

        let ownerName = settings.employerLink?.ownerName || '연동된 운송사';
        let ownerPhone = settings.employerLink?.ownerPhone || '';
        try {
            const { data: ownerProfile } = await client.from('profiles').select('name, phone, business_name').eq('id', latest.owner_id).maybeSingle();
            if (ownerProfile) {
                ownerName = ownerProfile.business_name || ownerProfile.name || ownerName;
                ownerPhone = ownerProfile.phone || ownerPhone;
            }
        } catch (profileError) {
            console.error('연동된 차주 프로필 조회 실패(연결 상태 자체는 복원됨):', profileError);
        }

        settings.employerLink = {
            id: settings.employerLink?.id || latest.id,
            supabaseId: latest.id,
            status: 'linked',
            ownerId: latest.owner_id,
            ownerName,
            ownerPhone,
            inviteCode: latest.invite_code,
            vehicleId: latest.vehicle_id,
            linkedAt: latest.linked_at || latest.created_at
        };
        localStorage.setItem('userSettings', JSON.stringify(settings));
    } catch (error) {
        console.error('기사 연동 상태 동기화 실패(로컬 캐시로 계속 진행):', error);
    }
}

async function syncDriverLinksFromSupabase() {
    const user = await getSupabaseUser();
    if (!user) return;
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client
            .from('driver_links')
            .select('*')
            .eq('owner_id', user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;

        const settings = getUserSettings();
        const cars = Array.isArray(settings.cars) ? settings.cars : [];
        const localLinks = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
        const localBySupabaseId = new Map(localLinks.filter(l => l.supabaseId).map(l => [l.supabaseId, l]));

        // 연결된(driver_id가 있는) 행은 실제 기사 이름/연락처를 profiles에서 채워 보여준다
        // (SQL의 "차주는 연동된 기사의 프로필을 조회 가능" 정책이 있어야 값이 온다).
        const linkedDriverIds = [...new Set((data || []).filter(row => row.driver_id).map(row => row.driver_id))];
        let driverProfiles = new Map();
        if (linkedDriverIds.length) {
            // settings(jsonb)도 함께 읽는다 — 기사 본인이 켜고 끄는 "거래처 세금계산서 공유"
            // 권한(shareClientTaxInvoicesWithOwner)이 여기(기사의 profiles.settings)에 저장돼
            // 있다. "차주는 연동된 기사의 프로필을 조회 가능" 정책이 profiles 행 전체에 대한
            // 조회를 허용하므로 settings 컬럼도 이미 읽을 수 있다 — 별도 RLS 변경 불필요.
            const { data: profileRows } = await client.from('profiles').select('id, name, phone, settings').in('id', linkedDriverIds);
            driverProfiles = new Map((profileRows || []).map(p => [p.id, p]));
        }

        const merged = (data || []).map(row => {
            const existing = localBySupabaseId.get(row.id) || null;
            const car = cars.find(c => c.supabaseId === row.vehicle_id);
            const driverProfile = row.driver_id ? driverProfiles.get(row.driver_id) : null;
            return {
                ...(existing || {}),
                id: existing?.id || row.id,
                supabaseId: row.id,
                driverName: driverProfile?.name || existing?.driverName || '',
                phone: driverProfile?.phone || existing?.phone || '',
                inviteCode: row.invite_code,
                vehicleId: row.vehicle_id,
                vehicleNumber: car?.number || existing?.vehicleNumber || '',
                assignmentStart: row.assignment_start,
                assignmentEnd: row.assignment_end,
                status: row.status,
                linkedAt: row.linked_at,
                updatedAt: row.updated_at,
                createdAt: row.created_at,
                // 로컬 캐시(existing)를 신뢰하지 않고 매번 서버 값(driverProfile.settings)을
                // 기준으로 덮어쓴다 — 차주 화면은 "기사가 서버에 저장해 둔 최신 권한"만 믿어야
                // 한다(§13). row.driver_id가 없는(아직 미연결) 초대는 항상 false로 취급.
                shareClientTaxInvoicesWithOwner: driverProfile?.settings?.shareClientTaxInvoicesWithOwner === true
            };
        });

        settings.driverLinks = merged;
        localStorage.setItem('userSettings', JSON.stringify(settings));
    } catch (error) {
        console.error('기사 연동 목록 동기화 실패(로컬 캐시로 계속 진행):', error);
    }
}

// 기사 쪽에서 6자리 초대 코드를 입력해 연결을 완료한다. 성공하면 연결된 driver_links 행
// (owner_id/vehicle_id 포함)을 반환하고, 실패하면 예외를 던진다(호출부가 메시지를 보여줌).
async function redeemDriverInviteCode(code) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('redeem_driver_invite_code', { p_code: code });
    if (error) throw error;
    return data;
}
