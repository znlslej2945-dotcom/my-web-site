const appState = {
    viewDate: new Date(),
    maintViewDate: new Date(),
    fuelViewDate: new Date(),
    miscViewDate: new Date(),
    selectedDateKey: null,
    activeLogId: 'main',
    workData: loadWorkDataForLog('main'),
    previousPage: 'main',
    isOffSelected: false,
    currentTempMaintItems: [],
    currentTempCallDetails: [],
    currentTempFuelItems: [],
    currentTempMiscItems: [],
    isDetailReportView: false,
    currentDetailClientFilter: 'ALL',
    calendarCells: [],
    confirmCallback: null
};

// 기존 변수명과의 호환성을 위한 참조 바인딩 (다른 함수들의 대규모 수정 최소화)
let viewDate = appState.viewDate;
let maintViewDate = appState.maintViewDate;
let fuelViewDate = appState.fuelViewDate;
let miscViewDate = appState.miscViewDate;
let selectedDateKey = appState.selectedDateKey;
let activeLogId = appState.activeLogId;
let workData = appState.workData;
let previousPage = appState.previousPage;
let isOffSelected = appState.isOffSelected;
let currentTempMaintItems = appState.currentTempMaintItems;
let currentTempCallDetails = appState.currentTempCallDetails;
let currentTempFuelItems = appState.currentTempFuelItems;
let currentTempMiscItems = appState.currentTempMiscItems;
// 고정노선 "상하차지 사용" 켰을 때, 오늘 이 날짜에 노선별로 몇 번 눌렀는지(routeId -> count)
// 임시로 들고 있다가 autoSaveWorkRecord()가 workData[selectedDateKey].fixedRouteCounts로
// 반영한다. currentTempCallDetails 등과 같은 패턴이다.
let currentTempFixedRouteCounts = {};
let isDetailReportView = appState.isDetailReportView;
let currentDetailClientFilter = appState.currentDetailClientFilter;
const calendarCells = appState.calendarCells;
let confirmCallback = appState.confirmCallback;
let driverConnectionReturnPage = 'main';
let activeLinkedDriverId = '';
let toastHideTimer = null;
const activeSaveActions = new Set();
const backgroundSaveStates = new Map();
// 하단 저장 상태 표시기(save-status-indicator)가 "저장실패"로 보여줄, 아직 재시도에
// 성공하지 못한 백그라운드 저장 키 목록. flushBackgroundSave가 성공/재시도 시작 때마다
// 지우고, 실패할 때마다 채운다.
const failedBackgroundSaveKeys = new Set();

async function runSaveAction(button, actionKey, action) {
    if (typeof action !== 'function') return false;
    const key = actionKey || action.name || 'save-action';
    if (activeSaveActions.has(key)) return false;

    activeSaveActions.add(key);
    const canUpdateButton = button && typeof button === 'object' && 'disabled' in button;
    const wasDisabled = canUpdateButton ? button.disabled : false;
    const previousAriaBusy = canUpdateButton ? button.getAttribute?.('aria-busy') : null;

    if (canUpdateButton) {
        button.disabled = true;
        button.classList?.add('save-action-loading');
        button.setAttribute?.('aria-busy', 'true');
    }

    try {
        await Promise.resolve().then(action);
        return true;
    } catch (error) {
        console.error(`${key} 저장 실패:`, error);
        showRetryableSaveError(error, () => runSaveAction(button, key, action));
        return false;
    } finally {
        activeSaveActions.delete(key);
        if (canUpdateButton) {
            button.disabled = wasDisabled;
            button.classList?.remove('save-action-loading');
            if (previousAriaBusy === null || previousAriaBusy === undefined) button.removeAttribute?.('aria-busy');
            else button.setAttribute?.('aria-busy', previousAriaBusy);
        }
    }
}

function queueBackgroundSave(actionKey, action, delay = 320) {
    if (typeof action !== 'function') return;
    const key = actionKey || action.name || 'background-save';
    const state = backgroundSaveStates.get(key) || { timer: null, running: false, runningPromise: null, nextAction: null };
    state.nextAction = action;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => flushBackgroundSave(key), Math.max(0, delay));
    backgroundSaveStates.set(key, state);
    updateSaveStatusIndicator();
}

async function flushBackgroundSave(actionKey) {
    const state = backgroundSaveStates.get(actionKey);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.running) {
        await state.runningPromise;
        if (backgroundSaveStates.has(actionKey)) return flushBackgroundSave(actionKey);
        return;
    }

    const action = state.nextAction;
    state.nextAction = null;
    if (!action) {
        backgroundSaveStates.delete(actionKey);
        updateSaveStatusIndicator();
        return;
    }

    state.running = true;
    state.runningPromise = Promise.resolve().then(action);
    // 이번 시도가 실패든 성공이든, 재시도가 다시 시작됐다는 뜻이므로 일단 "저장실패" 표시는
    // 내리고 스피너로 되돌린다(성공하면 그대로 사라지고, 다시 실패하면 아래 catch에서 다시 켠다).
    failedBackgroundSaveKeys.delete(actionKey);
    updateSaveStatusIndicator();
    try {
        await state.runningPromise;
    } catch (error) {
        console.error(`${actionKey} 자동 저장 실패:`, error);
        failedBackgroundSaveKeys.add(actionKey);
        showToastMessage(getSaveErrorMessage(error, true, actionKey), { duration: 7000 });
    } finally {
        state.running = false;
        state.runningPromise = null;
        if (state.nextAction) state.timer = setTimeout(() => flushBackgroundSave(actionKey), 0);
        else backgroundSaveStates.delete(actionKey);
        updateSaveStatusIndicator();
    }
}

async function flushAllBackgroundSaves() {
    while (backgroundSaveStates.size) {
        await Promise.all([...backgroundSaveStates.keys()].map(flushBackgroundSave));
    }
}

// 하단 네비게이션 바로 위에 떠 있는 저장 상태 표시기(#saveStatusIndicator). 평소엔 완전히
// 숨어 있다가, 백그라운드 저장(queueBackgroundSave 계열: 앱 설정/개인정보/운행기록 클라우드
// 동기화 등)이 대기·진행 중일 때만 조용히 스피너를 띄우고, 저장이 끝나면 바로 사라진다.
// 실패해서 재시도가 필요한 항목이 하나라도 있으면(failedBackgroundSaveKeys) 스피너 대신
// "저장실패" 문구로 바뀐다 — 이때 구체적으로 뭐가 실패했는지는 이 표시기가 아니라 토스트
// (getSaveErrorMessage)에서 안내한다.
function updateSaveStatusIndicator() {
    const el = document.getElementById('saveStatusIndicator');
    if (!el) return;
    const saving = backgroundSaveStates.size > 0;
    const failed = !saving && failedBackgroundSaveKeys.size > 0;
    el.classList.toggle('is-visible', saving || failed);
    el.classList.toggle('is-failed', failed);
}

// 오프라인 상태에서 저장이 실패해도(디바운스 타이머가 아직 남아있는 경우) 온라인으로
// 복귀하는 즉시 대기 중인 백그라운드 저장을 다시 시도한다. 이미 실패해서 큐에서 빠진
// 항목까지 되살리지는 못하지만(다음 편집 때 diff로 자연스럽게 재시도됨), 아직 대기 중인
// 저장은 온라인 복귀를 몇 분씩 기다리지 않고 즉시 반영된다.
window.addEventListener('online', () => {
    flushAllBackgroundSaves().catch(error => {
        console.error('온라인 복귀 후 대기 중인 저장 재시도 실패:', error);
    });
});

// 개인정보/운행기록을 입력하면 로컬(localStorage)에는 즉시 동기로 저장되지만, 클라우드
// 반영은 320~600ms 디바운스 타이머가 지난 뒤에야 실행된다. 문제는 이 타이머가 setTimeout
// 기반이라, 사용자가 입력 직후 앱을 백그라운드로 보내거나(다른 앱 전환, 화면 끄기) 탭을
// 완전히 닫으면 — 특히 모바일 브라우저는 백그라운드 탭의 타이머를 강하게 지연시키거나
// 아예 실행을 멈춘다 — 그 타이머가 영영 실행되지 않아 로컬엔 저장된 값이 클라우드에는
// 한 번도 반영되지 못하는 문제가 있었다(실제로 "완전히 종료하지 않으면 최종 저장이 안 된다"
// 는 형태로 보고됨). 로컬 값 자체는 항상 안전하지만, 다른 기기에서 로그인하거나 이 기기의
// 저장공간이 지워지면 그 사이 클라우드에 못 올라간 변경분이 사라진 것처럼 보인다.
//
// visibilitychange(탭이 백그라운드로 전환되는 시점)와 pagehide(실제 종료/이동 시점)에 남아있는
// 모든 배경 저장을 즉시 flush해서, 타이머가 지연되기 전에 최대한 빨리 실제로 반영되게 한다.
// beforeunload는 모바일에서 신뢰도가 낮아 pagehide를 함께 쓴다.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        flushAllBackgroundSaves().catch(error => {
            console.error('화면 전환 시 대기 중인 저장 반영 실패:', error);
        });
    }
});
window.addEventListener('pagehide', () => {
    flushAllBackgroundSaves().catch(() => {});
});

class RequestTimeoutError extends Error {
    constructor(message = '서버 응답 시간이 초과되었습니다.') {
        super(message);
        this.name = 'RequestTimeoutError';
        this.code = 'REQUEST_TIMEOUT';
    }
}

async function executeApiRequest(requestFactory, { timeoutMs = 10000 } = {}) {
    if (typeof requestFactory !== 'function') throw new TypeError('요청 함수가 필요합니다.');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller?.abort();
            reject(new RequestTimeoutError());
        }, Math.max(1000, timeoutMs));
    });

    try {
        return await Promise.race([
            Promise.resolve().then(() => requestFactory({ signal: controller?.signal })),
            timeoutPromise
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

// queueBackgroundSave의 actionKey만 보고 "무엇이" 저장 안 됐는지 사람이 읽을 수 있는 말로
// 바꾼다. 토스트 문구에서 "자동 저장에 실패했습니다"처럼 뭉뚱그리지 않고, 실제로 뭘 다시
// 저장해야 하는지 구체적으로 안내하기 위함이다. 매핑에 없는(내부용) 키는 빈 문자열을 반환해
// 기존처럼 일반 문구로 자연스럽게 대체된다.
function getSaveKeySubject(actionKey) {
    if (actionKey === 'settings') return '앱 설정';
    if (actionKey === 'personal-info') return '개인정보';
    if (actionKey === 'billing-settings') return '정산 설정';
    if (actionKey === 'supabase-settings-sync') return '앱 설정/개인정보(클라우드 동기화)';
    if (typeof actionKey === 'string' && actionKey.indexOf('supabase-workdata-sync-') === 0) return '운행 기록(클라우드 동기화)';
    return '';
}

function getSaveErrorMessage(error, isAutomatic = false, actionKey = '') {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const timedOut = error?.code === 'REQUEST_TIMEOUT'
        || error?.name === 'RequestTimeoutError'
        || error?.name === 'AbortError';
    const subject = getSaveKeySubject(actionKey);
    const label = subject ? `${subject} ` : '';
    if (offline) return `${label}${isAutomatic ? '자동 저장' : '저장'}하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`;
    if (timedOut) return `${label}서버 응답이 늦어 ${isAutomatic ? '자동 저장' : '저장'}을 완료하지 못했습니다. 다시 시도해 주세요.`;
    return `${label}${isAutomatic ? '자동 저장' : '저장'} 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.`;
}

function showRetryableSaveError(error, retryCallback) {
    showConfirmModal(getSaveErrorMessage(error), retryCallback, {
        title: '저장 실패',
        cancelLabel: '닫기',
        confirmLabel: '다시 시도',
        tone: 'primary'
    });
}

// 금액 만 단위 축약 표기 헬퍼
function formatFareShort(amount) {
    if (amount >= 10000) {
        let man = Math.round(amount / 10000);
        return `${man}만`;
    }
    return `${amount.toLocaleString()}원`;
}

// 설정 데이터 핸들러
function getUserSettings() {
    return JSON.parse(localStorage.getItem('userSettings')) || {};
}

// 예전엔 "고정노선의 고정 거래처/단가/파렛트"가 앱설정에 메인/기사차량별로 따로 있었는데,
// 이제 거래처 등록 화면에서 거래처 하나에 지정한다(§거래처 등록 개편, saveClient가 계정
// 전체에서 항상 최대 1곳만 켜지도록 보장한다). 메인/기사차량 구분 없이 이 거래처 하나를
// 그대로 쓴다 — 나중에 차량별로 따로 두고 싶어지면 client 쪽에 스코프 필드 하나만 추가하면
// 되는 구조라 되돌리기 쉽다.
function getFixedRouteClient(settings) {
    return (settings.clients || []).find(client => client.fixedRouteLinked) || null;
}

function getActiveLogSettings() {
    const settings = getUserSettings();
    if (activeLogId === 'main') return settings;

    return {
        ...settings,
        inputMode: settings.subInputMode,
        fixedOn: settings.subFixedOn,
        callDetailOn: settings.subCallDetailOn,
        paymentOn: settings.subPaymentOn,
        timeOn: settings.subTimeOn,
        platformOn: settings.subPlatformOn,
        distanceOn: settings.subDistanceOn,
        cargoTonnageOn: settings.hasOwnProperty('subCargoTonnageOn') ? settings.subCargoTonnageOn : true,
        runCountToggle: settings.subRunCountToggle,
        runCountPresets: settings.subRunCountPresets
    };
}
function setUserSettings(settings) {
    localStorage.setItem('userSettings', JSON.stringify(settings));
    scheduleNormalizedEntitySync();
    if (typeof scheduleSupabaseSettingsSync === 'function') scheduleSupabaseSettingsSync();
}

const NORMALIZED_SCHEMA_VERSION = 1;
const NORMALIZED_ENTITY_KEYS = Object.freeze({
    meta: 'normalizedSchemaMeta',
    users: 'entityUsers',
    vehicles: 'entityVehicles',
    dailyLogs: 'entityDailyLogs',
    transportDetails: 'entityTransportDetails',
    maintenanceRecords: 'entityMaintenanceRecords',
    fuelRecords: 'entityFuelRecords',
    miscExpenseRecords: 'entityMiscExpenseRecords',
    clients: 'entityClients',
    taxInvoices: 'entityTaxInvoices'
});

// FNV-1a를 서로 다른 시드/승수로 두 번 돌려 32비트 해시 두 조각(총 64비트, 16자리 hex)을 이어붙인다.
// 입력이 같으면 항상 같은 출력(결정론적)이며, 결과 공간이 기존 32비트(약 43억) 대비 크게 넓어진다.
// randomUUID 등 비결정적 값은 buildNormalizedEntitySnapshot()의 재실행 시 같은 레코드가 중복 생성되므로 쓰지 않는다.
function createNormalizedId(prefix, ...parts) {
    const source = parts.map(part => String(part ?? '')).join('|');

    const hashWithSeed = (seed, multiplier) => {
        let hash = seed;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, multiplier);
        }
        // 마무리 믹싱(avalanche) 라운드: 두 해시 절반이 비슷한 입력에서도 서로 잘 갈리도록 보강
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;
        return (hash >>> 0).toString(16).padStart(8, '0');
    };

    const high = hashWithSeed(2166136261, 16777619);
    const low = hashWithSeed(0x9e3779b9, 0x5bd1e995);
    return `${prefix}_${high}${low}`;
}

function getNormalizedUserId() {
    const storedId = localStorage.getItem('normalizedUserId');
    if (storedId) return storedId;
    const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const userId = `usr_${randomPart}`;
    localStorage.setItem('normalizedUserId', userId);
    return userId;
}

function parseEntityNumber(value) {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function getNormalizedVehicleSources(settings) {
    const cars = Array.isArray(settings.cars) ? settings.cars : [];
    const sources = new Map();
    const mainCar = cars.find(car => car?.type === 'main') || {
        number: settings.carNumber || 'main',
        tonnage: settings.carTonnage || '',
        type: 'main'
    };

    sources.set('main', { logId: 'main', storageKey: 'workData', car: mainCar });
    cars.filter(car => car?.type === 'sub' && car.number).forEach(car => {
        sources.set(car.number, { logId: car.number, storageKey: `workData_${car.number}`, car });
    });

    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith('workData_')) continue;
        const logId = key.slice('workData_'.length);
        if (!logId || sources.has(logId)) continue;
        sources.set(logId, {
            logId,
            storageKey: key,
            car: { number: logId, tonnage: '', type: 'sub', archived: true }
        });
    }
    return [...sources.values()];
}

function buildNormalizedEntitySnapshot() {
    const settings = getUserSettings();
    const userId = getNormalizedUserId();
    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    const clientEntities = clients.filter(client => client && typeof client === 'object').map((client, index) => ({
        ...client,
        id: createNormalizedId('cli', userId, client.companyName || index),
        userId,
        displayOrder: index
    }));
    const clientIdByName = new Map(clientEntities.map(client => [client.companyName, client.id]));

    const vehicleSources = getNormalizedVehicleSources(settings);
    const vehicleEntities = [];
    const vehicleIdByLogId = new Map();
    const vehicleIdByNumber = new Map();
    vehicleSources.forEach(({ logId, car }, index) => {
        const { personalInfo, ...vehicleFields } = car || {};
        const vehicleId = createNormalizedId('veh', userId, logId);
        const entity = {
            ...vehicleFields,
            id: vehicleId,
            userId,
            legacyLogId: logId,
            number: car?.number || (logId === 'main' ? '' : logId),
            type: car?.type || (logId === 'main' ? 'main' : 'sub'),
            displayOrder: index,
            driverLegalName: personalInfo?.name || '',
            driverBusinessNumber: personalInfo?.bizNumber || '',
            driverBankName: personalInfo?.bank || '',
            driverAccountNumber: personalInfo?.account || ''
        };
        vehicleEntities.push(entity);
        vehicleIdByLogId.set(logId, vehicleId);
        if (entity.number) vehicleIdByNumber.set(entity.number, vehicleId);
    });

    const dailyLogs = [];
    const transportDetails = [];
    const maintenanceRecords = [];
    const fuelRecords = [];
    const miscExpenseRecords = [];

    vehicleSources.forEach(({ logId, storageKey }) => {
        const vehicleId = vehicleIdByLogId.get(logId);
        const sourceData = readWorkDataStorage(storageKey);
        Object.keys(sourceData).sort().forEach(workDate => {
            const rawRecord = sourceData[workDate] === 'off'
                ? { isOff: true }
                : sourceData[workDate];
            if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) return;

            const {
                callDetails = [],
                maintItems = [],
                fuelItems = [],
                miscItems = [],
                ...dailyFields
            } = rawRecord;
            const dailyLogId = createNormalizedId('day', userId, vehicleId, workDate);
            dailyLogs.push({
                ...dailyFields,
                id: dailyLogId,
                userId,
                vehicleId,
                workDate,
                fixedCount: parseEntityNumber(rawRecord.fixedCount),
                palletCount: parseEntityNumber(rawRecord.palletCount)
            });

            (Array.isArray(callDetails) ? callDetails : []).forEach((detail, index) => {
                const safeDetail = detail && typeof detail === 'object' ? detail : {};
                transportDetails.push({
                    ...safeDetail,
                    id: createNormalizedId('trp', dailyLogId, 'detail', index),
                    dailyLogId,
                    userId,
                    vehicleId,
                    clientId: clientIdByName.get(safeDetail.client) || null,
                    workDate,
                    sequence: index,
                    sourceType: 'transport_detail',
                    fareAmount: parseEntityNumber(safeDetail.fare),
                    distanceKm: parseEntityNumber(safeDetail.distanceKm),
                    insuranceFeeAmount: parseEntityNumber(safeDetail.insuranceFee)
                });
            });

            (Array.isArray(maintItems) ? maintItems : []).forEach((item, index) => {
                const safeItem = item && typeof item === 'object' ? item : {};
                maintenanceRecords.push({
                    ...safeItem,
                    id: createNormalizedId('mnt', dailyLogId, index),
                    dailyLogId,
                    userId,
                    vehicleId,
                    workDate,
                    sequence: index,
                    costAmount: parseEntityNumber(safeItem.fare),
                    mileageKm: parseEntityNumber(safeItem.mileage)
                });
            });

            (Array.isArray(fuelItems) ? fuelItems : []).forEach((item, index) => {
                const safeItem = item && typeof item === 'object' ? item : {};
                fuelRecords.push({
                    ...safeItem,
                    id: createNormalizedId('ful', dailyLogId, index),
                    dailyLogId,
                    userId,
                    vehicleId,
                    workDate,
                    sequence: index,
                    costAmount: parseEntityNumber(safeItem.cost),
                    subsidyAmount: parseEntityNumber(safeItem.subsidy),
                    volumeLiter: parseEntityNumber(safeItem.liter),
                    mileageKm: parseEntityNumber(safeItem.mileage)
                });
            });

            (Array.isArray(miscItems) ? miscItems : []).forEach((item, index) => {
                const safeItem = item && typeof item === 'object' ? item : {};
                miscExpenseRecords.push({
                    ...safeItem,
                    id: createNormalizedId('msc', dailyLogId, index),
                    dailyLogId,
                    userId,
                    vehicleId,
                    workDate,
                    sequence: index,
                    costAmount: parseEntityNumber(safeItem.fare)
                });
            });
        });
    });

    const taxInvoiceEntities = getTaxInvoiceRecords().map((invoice, index) => {
        const safeInvoice = invoice && typeof invoice === 'object' ? invoice : {};
        const legacyId = safeInvoice.id || `${safeInvoice.flow || 'sales'}|${safeInvoice.monthKey || ''}|${safeInvoice.partyKey || index}`;
        return {
            ...safeInvoice,
            id: createNormalizedId('tax', userId, legacyId),
            legacyId,
            userId,
            vehicleId: vehicleIdByNumber.get(safeInvoice.carNumber) || null,
            clientId: clientIdByName.get(safeInvoice.clientName) || null,
            supplyAmount: parseEntityNumber(safeInvoice.supplyAmount),
            taxAmount: parseEntityNumber(safeInvoice.taxAmount),
            totalAmount: parseEntityNumber(safeInvoice.totalAmount)
        };
    });

    const userEntity = {
        id: userId,
        accountType: settings.accountType || '',
        name: settings.userName || '',
        phone: settings.userPhone || '',
        businessName: settings.bizName || '',
        businessNumber: settings.bizNumber || '',
        businessAddress: settings.bizAddress || '',
        businessType: settings.bizType || '',
        businessItem: settings.bizItem || '',
        businessEmail: settings.bizEmail || '',
        bankName: settings.bankName || '',
        accountNumber: settings.accountNumber || ''
    };
    const generatedAt = new Date().toISOString();
    const entities = {
        users: [userEntity],
        vehicles: vehicleEntities,
        dailyLogs,
        transportDetails,
        maintenanceRecords,
        fuelRecords,
        miscExpenseRecords,
        clients: clientEntities,
        taxInvoices: taxInvoiceEntities
    };
    const meta = {
        schemaVersion: NORMALIZED_SCHEMA_VERSION,
        generatedAt,
        source: 'legacy-local-storage-mirror',
        legacyCompatibility: true,
        relations: {
            vehicles: 'userId -> users.id',
            dailyLogs: 'vehicleId -> vehicles.id',
            transportDetails: 'dailyLogId -> dailyLogs.id',
            maintenanceRecords: 'dailyLogId -> dailyLogs.id',
            fuelRecords: 'dailyLogId -> dailyLogs.id',
            miscExpenseRecords: 'dailyLogId -> dailyLogs.id',
            taxInvoices: 'vehicleId -> vehicles.id, clientId -> clients.id'
        },
        counts: Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, value.length]))
    };
    return { meta, ...entities };
}

function syncNormalizedEntityStore() {
    const snapshot = buildNormalizedEntitySnapshot();
    const writes = new Map([
        [NORMALIZED_ENTITY_KEYS.meta, snapshot.meta],
        [NORMALIZED_ENTITY_KEYS.users, snapshot.users],
        [NORMALIZED_ENTITY_KEYS.vehicles, snapshot.vehicles],
        [NORMALIZED_ENTITY_KEYS.dailyLogs, snapshot.dailyLogs],
        [NORMALIZED_ENTITY_KEYS.transportDetails, snapshot.transportDetails],
        [NORMALIZED_ENTITY_KEYS.maintenanceRecords, snapshot.maintenanceRecords],
        [NORMALIZED_ENTITY_KEYS.fuelRecords, snapshot.fuelRecords],
        [NORMALIZED_ENTITY_KEYS.miscExpenseRecords, snapshot.miscExpenseRecords],
        [NORMALIZED_ENTITY_KEYS.clients, snapshot.clients],
        [NORMALIZED_ENTITY_KEYS.taxInvoices, snapshot.taxInvoices]
    ]);
    const previousValues = new Map([...writes.keys()].map(key => [key, localStorage.getItem(key)]));
    try {
        writes.forEach((value, key) => localStorage.setItem(key, JSON.stringify(value)));
    } catch (error) {
        previousValues.forEach((value, key) => {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        });
        throw error;
    }
    return snapshot;
}

function scheduleNormalizedEntitySync() {
    queueBackgroundSave('normalized-entities', syncNormalizedEntityStore, 180);
}

function getNormalizedEntitySnapshot() {
    const read = (key, fallback) => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            return value ?? fallback;
        } catch (error) {
            return fallback;
        }
    };
    return {
        meta: read(NORMALIZED_ENTITY_KEYS.meta, { schemaVersion: NORMALIZED_SCHEMA_VERSION }),
        users: read(NORMALIZED_ENTITY_KEYS.users, []),
        vehicles: read(NORMALIZED_ENTITY_KEYS.vehicles, []),
        dailyLogs: read(NORMALIZED_ENTITY_KEYS.dailyLogs, []),
        transportDetails: read(NORMALIZED_ENTITY_KEYS.transportDetails, []),
        maintenanceRecords: read(NORMALIZED_ENTITY_KEYS.maintenanceRecords, []),
        fuelRecords: read(NORMALIZED_ENTITY_KEYS.fuelRecords, []),
        miscExpenseRecords: read(NORMALIZED_ENTITY_KEYS.miscExpenseRecords, []),
        clients: read(NORMALIZED_ENTITY_KEYS.clients, []),
        taxInvoices: read(NORMALIZED_ENTITY_KEYS.taxInvoices, [])
    };
}

function isOwnerAccountType(type) {
    return type === 'owner_driver';
}

function getDriverSettlementModeMeta(mode) {
    const modes = {
        company: { label: '회사 정산', description: '회사가 거래처에 매출 계산서를 발행하고 기사 계산서를 수취합니다.' },
        driver_direct: { label: '기사 직접 정산', description: '기사가 거래처에 직접 발행하고 회사는 기사에게 수수료 계산서를 발행합니다.' },
        employee: { label: '직원 기사', description: '회사가 거래처에 발행하며 기사 계산서는 만들지 않습니다.' },
        none: { label: '계산서 미사용', description: '이 기사차량 운행분은 계산서 자동 생성에서 제외합니다.' }
    };
    return modes[mode] || modes.company;
}

function getEffectiveDriverSettlementMode(car, settings = getUserSettings()) {
    const selected = car?.settlementMode || 'default';
    return selected === 'default' ? (settings.defaultDriverSettlementMode || 'company') : selected;
}

// ========== 로그인/회원가입 3뷰 라우팅 ==========
// 구 "첫 시작 사용자 유형 선택"(accountTypePage) 화면은 앱 진입 흐름에서 완전히 제거됐다 —
// 차주/소속 기사 선택은 이제 회원가입 화면(authSignupView) 안의 탭으로 통합된다. 로그인
// 페이지는 항상 authIntroView(선택 화면)로 시작하고, 한 번에 반드시 1개 뷰만 보인다.
function showLocalLoginPage() {
    hideAllPages();
    document.body.classList.add('account-flow-active');
    document.getElementById('loginPage')?.classList.remove('hidden');
    showAuthSubView('intro');
}

// intro/login/signup 3개 뷰 중 하나만 보이게 전환하는 단일 함수.
function showAuthSubView(view) {
    const introView = document.getElementById('authIntroView');
    const loginView = document.getElementById('authLoginView');
    const signupView = document.getElementById('authSignupView');

    introView?.classList.toggle('hidden', view !== 'intro');
    loginView?.classList.toggle('hidden', view !== 'login');
    signupView?.classList.toggle('hidden', view !== 'signup');

    if (view === 'login') {
        // 로그인 화면에 들어올 때마다 입력값을 비워서 이전 시도의 흔적이 남지 않게 한다.
        const nameInput = document.getElementById('loginUserName');
        const phoneInput = document.getElementById('loginUserPhone');
        const passwordInput = document.getElementById('loginPassword');
        if (nameInput) nameInput.value = '';
        if (phoneInput) phoneInput.value = '';
        if (passwordInput) passwordInput.value = '';
        updateLoginButtonState();
    } else if (view === 'signup') {
        switchSignupRole(currentSignupRole || 'owner_driver');
        const nameInput = document.getElementById('signupName');
        const phoneInput = document.getElementById('signupPhone');
        const pwInput = document.getElementById('signupPw');
        const pwConfirmInput = document.getElementById('signupPwConfirm');
        const inviteInput = document.getElementById('signupInviteCode');
        if (nameInput) nameInput.value = '';
        if (phoneInput) phoneInput.value = '';
        if (pwInput) pwInput.value = '';
        if (pwConfirmInput) pwConfirmInput.value = '';
        if (inviteInput) inviteInput.value = '';
        updateSignupButtonState();
    }
}

// 회원가입 화면의 차주/소속 기사 탭 전환.
let currentSignupRole = 'owner_driver';
function switchSignupRole(role) {
    currentSignupRole = (role === 'employed_driver') ? 'employed_driver' : 'owner_driver';
    document.querySelectorAll('.auth-role-tab').forEach(tab => {
        const isTarget = tab.dataset.role === currentSignupRole;
        tab.classList.toggle('active', isTarget);
        tab.setAttribute('aria-checked', String(isTarget));
    });

    const subText = document.getElementById('signupRoleSubtitle');
    const inviteRow = document.getElementById('signupInviteBlock');
    if (currentSignupRole === 'owner_driver') {
        if (subText) subText.textContent = '본인 차량 일지 및 기사를 관리해요.';
        if (inviteRow) inviteRow.classList.add('hidden');
    } else {
        if (subText) subText.textContent = '초대 코드나 전화번호로 사장님과 연결해요.';
        if (inviteRow) inviteRow.classList.remove('hidden');
    }
    updateSignupButtonState();
}

function openForgotPwModal() {
    showConfirmModal(
        '비밀번호를 분실하셨나요?\n\n소속 기사님의 경우 사장님을 통해 임시 비밀번호를 재발급받으실 수 있습니다.\n기타 문의는 고객센터 1:1 문의를 이용해 주세요.',
        null,
        { title: '비밀번호 찾기', confirmLabel: '확인', cancelLabel: '닫기', tone: 'primary' }
    );
}

// [비회원으로 시작하기] — Supabase 계정을 만들지 않고 로컬에서만 앱을 사용한다.
// accountType(차주/소속기사)은 앱 전역의 아주 많은 로직(isOwnerAccountType 등)이 전제로
// 삼는 값이라 빈 채로 두지 않는다 — 이제 accountTypePage가 없어 별도 선택 화면으로
// 보낼 수 없으므로, 별도 선택 없이 기본값(차주)으로 시작하고 필요하면 나중에 마이페이지에서
// 정식 가입/역할을 다시 정할 수 있게 한다.
function startGuestMode() {
    const settings = getUserSettings();
    settings.accountType = settings.accountType || 'owner_driver';
    settings.driverType = settings.driverType || settings.accountType;
    settings.isLoggedIn = false;
    settings.onboardingCompleted = true;
    // isLoggedIn:false만으로는 "아직 로그인 전인 새 설치"와 "의도적으로 비회원을 선택함"을
    // 구분할 수 없다 — 이 플래그가 없으면 새로고침할 때마다(부팅 로직이 isLoggedIn이 false인
    // 사용자를 로그인 화면으로 보내므로) 매번 다시 "비회원으로 시작하기"를 눌러야 한다.
    settings.guestMode = true;
    setUserSettings(settings);
    document.body.classList.remove('account-flow-active');
    if (typeof loadSettings === 'function') loadSettings();
    updateAccountRoleUI();
    showToastMessage('비회원 모드로 시작합니다. 언제든 마이페이지에서 로그인할 수 있어요.');
    showMain();
}

// ---------- 로그인 화면 ----------
function updateLoginButtonState() {
    const name = document.getElementById('loginUserName')?.value.trim() || '';
    const phoneDigits = document.getElementById('loginUserPhone')?.value.replace(/\D/g, '') || '';
    const password = document.getElementById('loginPassword')?.value || '';
    const btn = document.getElementById('loginSubmitBtn');
    if (btn) btn.disabled = !name || phoneDigits.length < 10 || password.length < 6;
}

async function executeLoginAction() {
    const name = document.getElementById('loginUserName')?.value.trim() || '';
    const phone = document.getElementById('loginUserPhone')?.value.trim() || '';
    const password = document.getElementById('loginPassword')?.value || '';
    if (!name || phone.replace(/\D/g, '').length < 10) {
        showToastMessage('이름과 휴대전화 번호를 확인해 주세요.');
        return;
    }
    if (password.length < 6) {
        showToastMessage('비밀번호는 6자 이상 입력해 주세요.');
        return;
    }

    let authUser = null;
    if (typeof getSupabaseClient === 'function') {
        const email = phoneToFakeEmail(phone);
        const { data, error } = await supabaseSignIn(email, password);
        if (error) { showToastMessage(getSupabaseAuthErrorMessage(error)); return; }
        authUser = data?.user || null;
        if (authUser && typeof markSupabaseAccountEverCreated === 'function') markSupabaseAccountEverCreated();
    }

    // 로그인은 항상 "이미 계정이 있는" 기존 유저의 재접속이다 — 서버에 저장된 accountType/
    // 사업자정보 등을 그대로 복원한다(로컬에 남아있던 값으로 덮어쓰지 않는다).
    if (authUser && typeof hydrateFromSupabaseAndMigrate === 'function') {
        try {
            await hydrateFromSupabaseAndMigrate();
        } catch (error) {
            console.error('Supabase 데이터 동기화 실패(로컬 데이터로 계속 진행합니다):', error);
        }
    }

    const settings = getUserSettings();
    settings.userName = name;
    settings.userPhone = phone;
    settings.isLoggedIn = true;
    settings.onboardingCompleted = true;
    settings.guestMode = false;
    setUserSettings(settings);

    loadSettings();
    updateAccountRoleUI();
    renderSubCarMenu();
    showToastMessage('로그인되었습니다.');

    // 미연동 소속기사 안내는 더 이상 1.5초 뒤 스쳐 지나가는 토스트로 띄우지 않는다 — 로그인
    // 직후 잠깐 보이고 사라져서 놓치기 쉬웠다. 이제 알림 패널(getEmployerLinkNotificationItem)에
    // 연동되기 전까지 계속 남아있으면서, 눌러서 바로 연동 화면으로 갈 수 있다. showMain()이
    // 곧바로 updateOverdueNotification()을 통해 뱃지에 반영해 준다.
    showMain();
}

// ---------- 회원가입 화면 ----------
function updateSignupButtonState() {
    const name = document.getElementById('signupName')?.value.trim() || '';
    const phoneDigits = document.getElementById('signupPhone')?.value.replace(/\D/g, '') || '';
    const pw = document.getElementById('signupPw')?.value || '';
    const pwConfirm = document.getElementById('signupPwConfirm')?.value || '';
    const inviteDigits = document.getElementById('signupInviteCode')?.value.replace(/\D/g, '') || '';

    // 초대코드는 "소속 기사"일 때만, 그것도 선택 입력이다 — 아예 안 써도 되지만(가입 후
    // 나중에 연결해도 됨), 일부만 입력한 채로는 진행하지 못하게 막는다.
    const inviteFilledPartially = currentSignupRole === 'employed_driver' && inviteDigits.length > 0 && inviteDigits.length < 6;
    const pwOk = pw.length >= 6 && pw === pwConfirm;

    const btn = document.getElementById('signupSubmitBtn');
    if (btn) btn.disabled = !name || phoneDigits.length < 10 || !pwOk || inviteFilledPartially;
}

async function executeSignupAction() {
    const name = document.getElementById('signupName')?.value.trim() || '';
    const phone = document.getElementById('signupPhone')?.value.trim() || '';
    const pw = document.getElementById('signupPw')?.value || '';
    const pwConfirm = document.getElementById('signupPwConfirm')?.value || '';
    const inviteCode = currentSignupRole === 'employed_driver' ? (document.getElementById('signupInviteCode')?.value.trim() || '') : '';

    if (!name || phone.replace(/\D/g, '').length < 10) {
        showToastMessage('이름과 휴대전화 번호를 확인해 주세요.');
        return;
    }
    if (pw.length < 6) {
        showToastMessage('비밀번호는 6자 이상 입력해 주세요.');
        return;
    }
    if (pw !== pwConfirm) {
        showToastMessage('비밀번호 확인이 일치하지 않습니다.');
        return;
    }
    if (inviteCode && !/^\d{6}$/.test(inviteCode)) {
        showToastMessage('초대코드는 6자리 숫자로 입력해 주세요.');
        return;
    }

    const settings = getUserSettings();
    settings.accountType = currentSignupRole;
    settings.driverType = currentSignupRole;
    setUserSettings(settings);
    updateAccountRoleUI();

    // 여기서는 오직 "계정 생성"만 처리한다 — 기사 연결(redeemDriverInviteCode)은 가입이
    // 완전히 끝난 뒤 별도 단계로 시도하며, 그 단계가 실패해도 이미 만든 계정은 절대
    // 되돌리지 않는다.
    let authUser = null;
    if (typeof getSupabaseClient === 'function') {
        const email = phoneToFakeEmail(phone);
        const { data, error } = await supabaseSignUp(email, pw);
        if (error) { showToastMessage(getSupabaseAuthErrorMessage(error)); return; }
        authUser = data?.user || null;
        if (authUser) await ensureProfileRow(authUser.id, currentSignupRole, name, phone);
        if (authUser && typeof markSupabaseAccountEverCreated === 'function') markSupabaseAccountEverCreated();
    }

    // Supabase 데이터 로드 + (기존 로컬 데이터가 있다면) 1회 마이그레이션. 반드시 "신규 유저
    // 여부" 판별보다 먼저 실행해야 새 기기에서 가입하는 기존 로컬 데이터 보유자를 신규 유저로
    // 오인해 온보딩 마법사를 불필요하게 다시 띄우지 않는다.
    if (authUser && typeof hydrateFromSupabaseAndMigrate === 'function') {
        try {
            await hydrateFromSupabaseAndMigrate();
        } catch (error) {
            console.error('Supabase 데이터 동기화 실패(로컬 데이터로 계속 진행합니다):', error);
        }
    }

    const settingsAfterHydration = getUserSettings();
    settingsAfterHydration.userName = name;
    settingsAfterHydration.userPhone = phone;
    settingsAfterHydration.accountType = currentSignupRole;
    settingsAfterHydration.driverType = currentSignupRole;
    // "신규 유저"는 hydrate 이후에도 onboardingCompleted가 전혀 없던 경우만이다 — 이 기기에
    // 이미 온보딩을 마친 로컬 기록(예: 이 업데이트 이전부터 쓰던 기존 유저의 첫 클라우드
    // 가입)이 있다면 온보딩을 다시 띄우지 않는다.
    const isNewUser = !settingsAfterHydration.hasOwnProperty('onboardingCompleted');

    settingsAfterHydration.isLoggedIn = true;
    settingsAfterHydration.onboardingCompleted = true;
    settingsAfterHydration.guestMode = false;
    setUserSettings(settingsAfterHydration);

    loadSettings();
    updateAccountRoleUI();
    renderSubCarMenu();

    if (currentSignupRole === 'employed_driver' && /^\d{6}$/.test(inviteCode)) {
        try {
            await performEmployedDriverConnect(inviteCode);
            showToastMessage('가입 및 사장님 연결이 모두 완료되었습니다.');
        } catch (error) {
            console.error('회원가입 직후 기사 연동 실패(계정 생성 자체는 완료됨):', error);
            showToastMessage(`${getDriverLinkErrorMessage(error)} 마이페이지 > 소속 연결에서 다시 시도할 수 있어요.`);
        }
    } else {
        showToastMessage('회원가입이 완료되었습니다.');
    }

    // 신규 유저는 3문항 온보딩 마법사를 먼저 보여주고, 마법사 완료 시점에 showMain()을 호출한다.
    // (드물게) 이미 온보딩을 마친 기존 로컬 데이터를 들고 처음 가입하는 경우는 마법사를
    // 건너뛰고 바로 메인으로 이동한다.
    if (isNewUser) {
        openOnboardingWizard();
    } else {
        showMain();
    }
}

// ========== 신규 유저용 온보딩 마법사 ==========
let onboardingWizardState = null;

// 계정 유형/차량 등록 상태에 따라 이번 마법사에서 보여줄 스텝 순서를 계산한다.
// (운행방식 → 결제여부 → 선택항목 → 차량등록[이미 메인 차량이 있으면 생략] → 정산방식[소속기사면 생략])
function getOnboardingStepSequence(settings) {
    const hasMainCar = (settings.cars || []).some(c => c.type === 'main');
    const isEmployedDriver = settings.accountType === 'employed_driver';
    const seq = [1, 2, 3];
    // 소속 기사는 메인 차량을 직접 입력하지 않는다 — openCarModal('main')과 동일한 이유로,
    // 반드시 차주와의 연동(초대코드)을 통해서만 채워져야 한다. 연동에 성공하면
    // applyEmployerAutoFilledInfo()가 이미 이 스텝이 열리기 전에 메인 차량을 채워 넣으므로
    // hasMainCar가 true가 되어 자연히 건너뛴다 — 아직 연동 전(또는 연동 자동입력이
    // 실패)이라도 이 스텝에서 임의의 차량번호를 직접 입력하게 두면, 나중에 실제로 연동됐을
    // 때 그 차량과 별개인 "가짜" 차량이 남아 운행기록이 갈라지는 문제로 이어진다.
    if (!hasMainCar && !isEmployedDriver) seq.push(4);
    if (!isEmployedDriver) seq.push(5);
    return seq;
}

function getDefaultOnboardingWizardState() {
    const settings = getUserSettings();
    return {
        step: 1,
        stepSequence: getOnboardingStepSequence(settings), // 마법사 시작 시점에 고정 (진행 중 변경되지 않음)
        workStyle: null,      // 'fixed' | 'call' | 'both'
        palletOn: false,
        paymentOn: null,      // true | false
        timeOn: false,
        cargoTonnageOn: false,
        platformOn: false,
        distanceOn: false,
        settlementMode: null  // 'company' | 'driver_direct' | 'employee' | 'none' | null(건너뛰기)
    };
}

// 풀스크린 온보딩 페이지(#onboardingPage)를 연다. 회원가입 직후에만 호출된다
// (executeSignupAction 참고). 이전 실행에서 남은 active 표시가 있을 수 있으니 초기화한다 —
// step4(차량 등록)의 카드는 토글이 아니라 항상 강조돼야 하는 단일 버튼이라 제외한다.
function openOnboardingWizard() {
    onboardingWizardState = getDefaultOnboardingWizardState();

    document.querySelectorAll('#onboardingStep1 .onboarding-card-btn, #onboardingStep2 .onboarding-card-btn, #onboardingStep3 .onboarding-card-btn, #onboardingStep5 .onboarding-card-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('onboardingPalletCard')?.classList.add('hidden');
    const palletToggle = document.getElementById('onboardingPalletToggle');
    if (palletToggle) palletToggle.checked = false;
    const carNumInput = document.getElementById('onboardingCarNumber');
    const carTonInput = document.getElementById('onboardingCarTonnage');
    if (carNumInput) carNumInput.value = '';
    if (carTonInput) carTonInput.value = '';

    hideAllPages();
    document.body.classList.add('account-flow-active');
    document.getElementById('onboardingPage')?.classList.remove('hidden');

    showOnboardingWizardStep(onboardingWizardState.stepSequence[0]);
}

function showOnboardingWizardStep(step) {
    if (!onboardingWizardState) return;
    onboardingWizardState.step = step;

    [1, 2, 3, 4, 5].forEach(n => {
        document.getElementById(`onboardingStep${n}`)?.classList.toggle('hidden', n !== step);
    });

    const seq = onboardingWizardState.stepSequence;
    const idx = seq.indexOf(step);

    // 1단계(idx === 0)에서는 뒤로갈 곳이 없으니 숨기고, 2단계부터 노출한다.
    document.getElementById('onboardingBackBtn')?.classList.toggle('hidden', idx <= 0);

    const counter = document.getElementById('onboardingStepCounter');
    if (counter) counter.textContent = `${idx + 1}/${seq.length}`;

    const nextBtn = document.getElementById('onboardingNextBtn');
    if (nextBtn) {
        nextBtn.textContent = (idx === seq.length - 1) ? '완료하기' : '다음';
        // Step1: 근무방식 선택 여부, Step2: 수금관리 선택 여부, Step4: 차량번호 2자 이상
        // 입력 여부가 있어야 "다음"이 활성화된다(건너뛰기는 이 조건과 무관하게 항상 가능).
        // 그 외 스텝(선택항목/정산방식)은 전부 선택 사항이라 항상 진행 가능하다.
        if (step === 1) nextBtn.disabled = !onboardingWizardState.workStyle;
        else if (step === 2) nextBtn.disabled = onboardingWizardState.paymentOn === null;
        else if (step === 4) updateOnboardingStep4State();
        else nextBtn.disabled = false;
    }
}

function selectOnboardingWorkStyle(value, btnEl) {
    if (!onboardingWizardState) return;
    onboardingWizardState.workStyle = value;
    document.querySelectorAll('#onboardingStep1 .onboarding-card-btn').forEach(btn => btn.classList.toggle('active', btn === btnEl));

    // 고정노선이 하나라도 포함된 방식(정해진 노선 / 둘 다)일 때만 파렛트 회수 여부를 물어본다.
    const showPallet = value === 'fixed' || value === 'both';
    document.getElementById('onboardingPalletCard')?.classList.toggle('hidden', !showPallet);
    if (!showPallet) {
        onboardingWizardState.palletOn = false;
        const palletToggle = document.getElementById('onboardingPalletToggle');
        if (palletToggle) palletToggle.checked = false;
    }

    const nextBtn = document.getElementById('onboardingNextBtn');
    if (nextBtn) nextBtn.disabled = false;
}

function toggleOnboardingPallet(checked) {
    if (!onboardingWizardState) return;
    onboardingWizardState.palletOn = checked;
}

// 상단 뒤로가기(<) — 현재 스텝 시퀀스 기준으로 바로 이전 스텝으로 돌아간다. 1단계에서는
// 버튼 자체가 숨겨져 있어 호출되지 않는다.
function goBackOnboardingStep() {
    if (!onboardingWizardState) return;
    const seq = onboardingWizardState.stepSequence;
    const idx = seq.indexOf(onboardingWizardState.step);
    if (idx > 0) {
        showOnboardingWizardStep(seq[idx - 1]);
    }
}

function selectOnboardingPayment(value, btnEl) {
    if (!onboardingWizardState) return;
    onboardingWizardState.paymentOn = value;
    document.querySelectorAll('#onboardingStep2 .onboarding-card-btn').forEach(btn => btn.classList.toggle('active', btn === btnEl));
    const nextBtn = document.getElementById('onboardingNextBtn');
    if (nextBtn) nextBtn.disabled = false;
}

// Step3(선택 항목)은 다중 선택 카드 — 클릭할 때마다 켜고 끈다.
function toggleOnboardingOptionCard(field, btnEl) {
    if (!onboardingWizardState) return;
    onboardingWizardState[field] = !onboardingWizardState[field];
    btnEl.classList.toggle('active', onboardingWizardState[field]);
}

// Step4(차량 등록) - 모달을 띄우지 않고 화면 안 입력란에 바로 차량번호/톤수를 입력받는다.
// 차량번호가 2글자 이상이어야 "다음"이 활성화된다(건너뛰기는 언제든 가능). 실제 저장은
// finishOnboardingWizard()가 이 스텝을 지나갈 때(다음으로 진행하거나 마법사를 끝낼 때) 한
// 번에 처리한다.
function updateOnboardingStep4State() {
    const carNum = document.getElementById('onboardingCarNumber')?.value.trim() || '';
    const nextBtn = document.getElementById('onboardingNextBtn');
    if (nextBtn) nextBtn.disabled = carNum.length < 2;
}

// Step5(정산 방식, 차주 계정만 노출)
function selectOnboardingSettlementMode(value, btnEl) {
    if (!onboardingWizardState) return;
    onboardingWizardState.settlementMode = value;
    document.querySelectorAll('#onboardingStep5 .onboarding-card-btn').forEach(btn => btn.classList.toggle('active', btn === btnEl));
}

// 현재 스텝에서 다음 스텝으로 진행하거나, 더 이상 스텝이 없으면 마법사를 완료 처리한다.
// "다음"과 "건너뛰기 >"가 공유하는 단일 진행 함수다 — 진행 가능 여부(다음 버튼 disabled)는
// showOnboardingWizardStep()이 이미 걸러주므로, 여기서는 그냥 다음으로 넘어가기만 한다.
function advanceOnboardingStep() {
    if (!onboardingWizardState) return;
    const seq = onboardingWizardState.stepSequence;
    const idx = seq.indexOf(onboardingWizardState.step);
    if (idx === -1 || idx >= seq.length - 1) {
        finishOnboardingWizard();
    } else {
        showOnboardingWizardStep(seq[idx + 1]);
    }
}

function skipCurrentOnboardingStep() {
    advanceOnboardingStep();
}

function finishOnboardingWizard() {
    if (!onboardingWizardState) return;

    const isFixed = onboardingWizardState.workStyle === 'fixed' || onboardingWizardState.workStyle === 'both';
    const isCall = onboardingWizardState.workStyle === 'call' || onboardingWizardState.workStyle === 'both';

    const settings = getUserSettings();
    settings.fixedOn = isFixed;
    settings.callDetailOn = isCall;
    // 파렛트 회수는 이제 거래처 등록 화면에서 거래처별로 설정한다(§거래처 등록 개편) —
    // 온보딩 시점엔 아직 거래처를 안 만들었을 수 있어서 여기서 값을 저장할 곳이 없다.
    settings.paymentOn = !!onboardingWizardState.paymentOn;
    settings.timeOn = !!onboardingWizardState.timeOn;
    settings.cargoTonnageOn = !!onboardingWizardState.cargoTonnageOn;
    settings.platformOn = !!onboardingWizardState.platformOn;
    settings.distanceOn = !!onboardingWizardState.distanceOn;
    if (onboardingWizardState.settlementMode) {
        settings.defaultDriverSettlementMode = onboardingWizardState.settlementMode;
    }

    // Step4(차량 등록) 인라인 입력값 저장. 이 스텝 자체가 "메인 차량이 아직 없을 때만"
    // stepSequence에 포함되므로(getOnboardingStepSequence), 여기 도달했다는 것 자체가
    // 마법사 시작 시점엔 메인 차량이 없었다는 뜻이다 — 그래도 saveCarFromModal()과 동일하게
    // 기존 메인 차량이 있으면 새로 만들지 않고 그 차량을 갱신한다(방어적 처리).
    const carNum = document.getElementById('onboardingCarNumber')?.value.trim();
    const carTon = document.getElementById('onboardingCarTonnage')?.value.trim() || '';
    if (carNum) {
        if (!Array.isArray(settings.cars)) settings.cars = [];
        const mainCar = settings.cars.find(c => c.type === 'main');
        if (mainCar) {
            mainCar.number = carNum;
            mainCar.tonnage = carTon;
        } else {
            settings.cars.unshift({ type: 'main', number: carNum, tonnage: carTon });
        }
    }

    settings.onboardingCompleted = true;
    setUserSettings(settings);

    onboardingWizardState = null;

    loadSettings();
    showMain();
}

function updateAccountRoleUI() {
    const settings = getUserSettings();
    const ownerRole = isOwnerAccountType(settings.accountType);
    document.getElementById('employedDriverLinkCard')?.classList.toggle('hidden', settings.accountType !== 'employed_driver');
    // 마이페이지의 "연결 관리" 바로가기 — 예전엔 차주에게만 보였고, 소속기사는 이 항목이
    // 아예 없어서 개인정보 화면까지 들어가야만 소속 연결 카드를 찾을 수 있었다. 차주와
    // 동일하게 마이페이지에서 바로 접근하도록 두 역할 모두에게 보여주고, 라벨만 역할에 맞게
    // 바꾼다 — showDriverConnectionManagement()가 이미 역할에 따라 알맞은 화면(차주: 기사
    // 연동 관리 페이지 / 소속기사: 개인정보의 소속 연결 카드)으로 안내해 준다.
    const driverConnectionLink = document.getElementById('myPageDriverConnectionLink');
    if (driverConnectionLink) {
        driverConnectionLink.classList.remove('hidden');
        const label = driverConnectionLink.querySelector('span');
        if (label) label.textContent = ownerRole ? '기사연동관리' : '소속 연결 관리';
    }
    // 소속 연결 카드가 사업자정보 카드 자리를 대신 채우면서(아래 applyPersonalInfoRoleUI)
    // 두 계정 종류 모두 카드 4개(정보1/정보2/연결또는사업자/계정)로 맞춰져 계정 카드 번호는
    // 이제 역할과 무관하게 항상 '04'다.
    const accountCardNumber = document.getElementById('personalAccountCardNumber');
    if (accountCardNumber) accountCardNumber.textContent = '04';

    const loginButton = document.getElementById('personalLoginBtn');
    const logoutButton = document.getElementById('personalLogoutBtn');
    loginButton?.classList.toggle('hidden', !!settings.isLoggedIn);
    logoutButton?.classList.toggle('hidden', !settings.isLoggedIn);
    renderEmployedDriverLinkState();
    applyPersonalInfoRoleUI(settings.accountType);
}

// 계정 종류에 따라 개인정보 화면의 카드 구성을 바꾼다.
// - 차주(owner_driver): 기존과 동일하게 사업자정보 카드를 그대로 보여준다.
// - 소속기사(employed_driver): 회사 사업자정보 카드를 숨기고(입력/수정 자체를 막음),
//   "대표자·연락처" 카드를 기사 본인 정보 중심 문구로 바꿔서 재사용한다.
// 중요: bizName 등 입력란은 DOM에서 "숨기기"만 할 뿐 제거하지 않는다 — loadSettings()가
// 화면을 열 때마다 그 값을 그대로 채워 넣으므로, 숨겨진 채로 commitPersonalInfo()가 실행돼도
// 기존 값(차주에게서 자동반영된 사업자정보 포함)이 그대로 왕복 저장될 뿐 손실되지 않는다.
function applyPersonalInfoRoleUI(accountType) {
    const isEmployedDriver = accountType === 'employed_driver';

    document.getElementById('bizInfoCard')?.classList.toggle('hidden', isEmployedDriver);

    const contactTitle = document.getElementById('contactCardTitle');
    const contactDesc = document.getElementById('contactCardDesc');
    const userNameLabel = document.getElementById('userNameLabel');
    const contactIcon = document.getElementById('contactCardIcon');
    const settlementIcon = document.getElementById('settlementCardIcon');

    if (contactTitle) contactTitle.textContent = isEmployedDriver ? '기사 정보' : '대표자 · 연락처';
    if (contactDesc) contactDesc.textContent = isEmployedDriver ? '본인 기본 정보' : '대표자 기본 정보';
    if (userNameLabel) userNameLabel.textContent = isEmployedDriver ? '이름' : '성명 (대표자)';
    if (contactIcon) contactIcon.textContent = isEmployedDriver ? '01' : '02';
    if (settlementIcon) settlementIcon.textContent = isEmployedDriver ? '02' : '03';
}

function showConfirmModal(msg, callback, options = {}) {
    const modal = document.getElementById('confirmModal');
    const title = document.getElementById('confirmModalTitle');
    const cancelButton = document.getElementById('confirmModalCancelBtn');
    const confirmButton = document.getElementById('confirmModalConfirmBtn');
    document.getElementById('confirmModalText').innerText = msg;
    if (title) title.textContent = options.title || '경고';
    if (cancelButton) cancelButton.textContent = options.cancelLabel || '취소';
    if (confirmButton) confirmButton.textContent = options.confirmLabel || '확인';
    modal.dataset.tone = options.tone || 'danger';
    confirmCallback = callback;
    modal.classList.remove('hidden');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    modal.classList.add('hidden');
    delete modal.dataset.tone;
    confirmCallback = null;
}

function executeConfirm() {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
}

function getShortCarNum(carNum) {
    if (!carNum || carNum === 'main') return carNum;
    const match = carNum.match(/\d{4}$/); 
    return match ? match[0] : carNum; 
}

function updateTransportSettingsUI() {
    const settings = getUserSettings();
    const cars = settings.cars || [];
    const hasActiveSubLog = cars.some(car => car.type === 'sub' && car.logEnabled);
    const mainTitle = document.getElementById('mainSettingsTitle');
    
    if (hasActiveSubLog) {
        if(mainTitle) mainTitle.innerText = '메인 운행 일지 설정';
    } else {
        if(mainTitle) mainTitle.innerText = '운행 일지 설정';
    }
}

function renderSubCarMenu() {
    const container = document.getElementById('subCarLogMenuContainer');
    if (!container) return;
    container.innerHTML = '';
    
    const settings = getUserSettings();
    const cars = settings.cars || [];

    cars.forEach(car => {
        if (car.type === 'sub' && car.logEnabled) {
            const wrapper = document.createElement('div');
            wrapper.className = 'menu-item-wrapper';

            const btn = document.createElement('button');
            btn.className = 'dropdown-item';
            const shortNum = getShortCarNum(car.number);
            const driverName = car.personalInfo && car.personalInfo.driverName ? car.personalInfo.driverName : '';
            btn.title = driverName ? `${car.number} · ${driverName} 운행일지` : `${car.number} 운행일지`;
            
            if (activeLogId === car.number) {
                btn.style.cssText = 'display: flex; align-items: center; gap: 10px; color: var(--sub-text-color); padding-right: 0; opacity: 0.4; cursor: default;';
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    <span class="sub-car-menu-label">${escapeDetailText(shortNum)} 일지</span>
                `;
            } else {
                btn.style.cssText = 'display: flex; align-items: center; gap: 10px; color: var(--sub-text-color); padding-right: 0;';
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    <span class="sub-car-menu-label">${escapeDetailText(shortNum)} 일지</span>
                `;
                btn.onclick = () => switchCarLog(car.number);
            }

            const gearBtn = document.createElement('button');
            gearBtn.className = 'menu-item-gear';
            gearBtn.title = "기사차량 운행일지 설정";
            gearBtn.innerHTML = `
                <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            `;
            gearBtn.onclick = (e) => {
                e.stopPropagation(); 
                showSubCarSettings(car.number);
            };

            wrapper.appendChild(btn);
            wrapper.appendChild(gearBtn);
            container.appendChild(wrapper);
        }
    });
    renderLinkedDriverMenu();
}

function renderLinkedDriverMenu() {
    const container = document.getElementById('linkedDriverMenuContainer');
    if (!container) return;
    container.innerHTML = '';
    const settings = getUserSettings();
    if (!isOwnerAccountType(settings.accountType)) return;

    (settings.driverLinks || [])
        .filter(link => link.status === 'linked')
        .forEach(link => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dropdown-item linked-driver-menu-item';
            const shortNumber = getShortCarNum(link.vehicleNumber || '차량');
            button.title = `${link.driverName || '기사'} · ${link.vehicleNumber || '차량 미지정'} 기록 관리`;
            button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"></circle><path d="M2 21v-2a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v2"></path><path d="M17 11h5M19.5 8.5v5"></path></svg><span class="sub-car-menu-label">${escapeDetailText(shortNumber)} 관리</span>`;
            button.onclick = () => showLinkedDriverManagement(link.id);
            container.appendChild(button);
        });
}

function getAssignmentState(link) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = link.assignmentStart ? new Date(`${link.assignmentStart}T00:00:00`) : null;
    const end = link.assignmentEnd ? new Date(`${link.assignmentEnd}T23:59:59`) : null;
    if (start && start > today) return { key: 'scheduled', label: '할당 예정' };
    if (end && end < today) return { key: 'ended', label: '할당 종료' };
    return { key: 'active', label: '할당 중' };
}

// 같은 차량에 할당 기간이 겹치는 기사가 있는지 확인 (assignmentStart/End 중복 체크)
function assignmentRangesOverlap(startA, endA, startB, endB) {
    const aEnd = endA || '9999-12-31';
    const bEnd = endB || '9999-12-31';
    return startA <= bEnd && startB <= aEnd;
}

function findOverlappingDriverLink(links, vehicleNumber, start, end, excludeId) {
    if (!vehicleNumber || !start) return null;
    return (links || []).find(link => {
        if (excludeId && link.id === excludeId) return false;
        if (link.status === 'disconnected') return false;
        if ((link.vehicleNumber || '') !== vehicleNumber) return false;
        if (!link.assignmentStart) return false;
        return assignmentRangesOverlap(start, end, link.assignmentStart, link.assignmentEnd || '');
    });
}

// 차주가 연동된 기사의 기록을 조회/집계할 때, 해당 날짜가 실제 할당 기간 안에 있는지 판별한다.
// 소속기사 본인의 workData 조회에는 적용하지 않는다 (연동 조회/집계 전용).
function isDateWithinAssignment(dateKey, assignmentStart, assignmentEnd) {
    if (!assignmentStart) return true; // 할당 시작일 자체가 없으면 제한 없이 전부 포함 (레거시 데이터 보호)
    if (dateKey < assignmentStart) return false;
    if (assignmentEnd && dateKey > assignmentEnd) return false;
    return true;
}

function generateLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateDriverInviteCode(targetInputId = 'linkedDriverInviteCode') {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const input = document.getElementById(targetInputId);
    if (input) input.value = code;
}

// 기사 연동 초대코드를 기사 연락처로 문자 발송한다("기사 연동 관리" 화면과 차량등록의 2차
// 기사연동 모달 양쪽에서 재사용). 실제 발송은 서버 SMS API가 아니라 기기의 문자 앱을
// sms: 스킴으로 열어주는 방식이라 별도 발송 인프라/RLS가 필요 없다.
function sendDriverInviteSms(source = 'management') {
    const isManagement = source === 'management';
    const name = isManagement
        ? document.getElementById('linkedDriverName')?.value.trim()
        : document.getElementById('carInviteDriverName')?.value.trim();
    const phone = isManagement
        ? document.getElementById('linkedDriverPhone')?.value.trim()
        : document.getElementById('carInvitePhone')?.value.trim();
    const code = isManagement
        ? document.getElementById('linkedDriverInviteCode')?.value.trim()
        : document.getElementById('carInviteCode')?.value.trim();
    const vehicle = isManagement
        ? document.getElementById('linkedDriverVehicle')?.value.trim()
        : document.getElementById('carInviteVehicleNumber')?.value.trim();

    if (!phone || phone.replace(/\D/g, '').length < 10) {
        showToastMessage('기사 전화번호를 먼저 올바르게 입력해 주세요.');
        return;
    }
    if (!code || !/^\d{6}$/.test(code)) {
        showToastMessage('6자리 초대 코드를 먼저 생성해 주세요.');
        return;
    }

    const settings = getUserSettings();
    const ownerDisplayName = settings.bizName || settings.userName || '운송사';
    const message = `[운행일지] 안녕하세요, ${ownerDisplayName}입니다.${name ? ` ${name}기사님,` : ''}\n${vehicle ? `[${vehicle}] 차량 ` : ''}소속 기사 연동 초대 코드입니다.\n\n▶ 초대 코드: ${code}\n\n운행일지 앱 실행 후 [마이페이지 > 소속 연결]에서 위 코드를 입력해 주세요.`;

    const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
    window.location.href = `sms:${phone}${separator}body=${encodeURIComponent(message)}`;
}

// "할당 차량" 자동완성 목록. 두 종류를 제외한다:
// 1) 메인 차량 — 메인 차량은 차주 본인 차량이라 애초에 기사에게 할당할 대상이 아니다.
// 2) 지금 이 순간 다른 기사에게 이미(할당 종료일이 없거나 아직 안 지난) 활성 할당돼 있는
//    기사차량 — 겹치는 기간으로 저장하면 performSaveLinkedDriverInvitation()의 겹침 검사에서
//    어차피 막히지만, 애초에 자동완성에 후보로 뜨지 않는 편이 헷갈리지 않는다. 지금 수정
//    중인 초대 자신의 차량은 계속 후보에 남아야 하므로 제외 대상에서 뺀다.
function populateLinkedDriverVehicleOptions() {
    const datalist = document.getElementById('linkedDriverVehicleOptions');
    if (!datalist) return;
    const settings = getUserSettings();
    const cars = settings.cars || [];
    const links = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
    const editingId = document.getElementById('linkedDriverEditId')?.value || '';
    const today = getTodayDateKey();

    const activelyAssignedNumbers = new Set(
        links
            .filter(link => link.id !== editingId && link.status !== 'disconnected' && link.vehicleNumber && (!link.assignmentEnd || link.assignmentEnd >= today))
            .map(link => link.vehicleNumber)
    );

    datalist.innerHTML = cars
        .filter(car => car.number && car.type !== 'main' && !activelyAssignedNumbers.has(car.number))
        .map(car => `<option value="${escapeDetailText(car.number)}"></option>`)
        .join('');
}

function showDriverConnectionManagement(returnPage = 'main') {
    const settings = getUserSettings();
    if (!isOwnerAccountType(settings.accountType)) {
        // 소속 기사 계정은 이 화면(차주 전용 초대 관리)을 쓸 수 없다 — 경고 모달로 막고 끝내는
        // 대신, 본인이 차주와 연동된 상태를 그대로 볼 수 있는 개인정보 페이지의 "소속 연결"
        // 카드로 데려간다. 이 함수를 부른 곳이 알려준 returnPage를 그대로 넘겨야
        // goBackFromPersonalInfo()가 원래 있던 화면(마이페이지 등)으로 정확히 되돌아간다 —
        // personalInfoReturnPage(이전에 개인정보 화면에 마지막으로 들어왔을 때 남은 값)를
        // 그대로 쓰면, 마이페이지에서 들어왔는데 엉뚱한 화면으로 튕겨 나갈 수 있었다.
        showPersonalInfo(returnPage);
        requestAnimationFrame(() => {
            document.getElementById('employedDriverLinkCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
    }
    driverConnectionReturnPage = ['personal', 'car', 'myPage'].includes(returnPage) ? returnPage : 'main';
    hideAllPages();
    document.getElementById('driverConnectionManagementPage').classList.remove('hidden');
    populateLinkedDriverVehicleOptions();
    renderLinkedDriverList();
    // 새 초대 작성 상태로 처음 들어왔다면(수정 중이 아니고 폼이 비어 있으면), 차량 관리에
    // 이미 등록해 둔 기사차량 정보를 기본값으로 채워 같은 정보를 두 번 입력하지 않게 한다.
    initializeLinkedDriverInvitationForm();
    setActiveNav(['personal', 'myPage'].includes(driverConnectionReturnPage) ? 'personal' : 'main');

    // 서버 기준 최신 연동 상태로 갱신한다 — 특히 기사가 그동안 코드를 입력해서 연결을
    // 완료했는지는 오직 서버 조회로만 알 수 있다. 화면을 막지 않도록 기다리지 않고
    // 백그라운드로 돌리고, 끝나면(그리고 아직 이 화면이 보이는 중이면) 다시 그린다.
    if (typeof syncDriverLinksFromSupabase === 'function') {
        syncDriverLinksFromSupabase().then(() => {
            if (!document.getElementById('driverConnectionManagementPage')?.classList.contains('hidden')) {
                renderLinkedDriverList();
            }
        });
    }
}

function goBackFromDriverConnectionManagement() {
    if (driverConnectionReturnPage === 'personal') showPersonalInfo(personalInfoReturnPage);
    else if (driverConnectionReturnPage === 'car') showCarManagement();
    else if (driverConnectionReturnPage === 'myPage') showMyPage();
    else showMain();
}

function returnToDriverConnectionManagement() {
    showDriverConnectionManagement(driverConnectionReturnPage);
}

function resetLinkedDriverForm() {
    ['linkedDriverEditId', 'linkedDriverName', 'linkedDriverPhone', 'linkedDriverInviteCode', 'linkedDriverVehicle', 'linkedDriverAssignmentStart', 'linkedDriverAssignmentEnd']
        .forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
    const saveButton = document.getElementById('linkedDriverSaveBtn');
    if (saveButton) saveButton.textContent = '초대 저장';
    generateDriverInviteCode();
    // 폼을 완전히 비웠으니 자동입력 추적 상태도 초기화하고, 새 초대 기준으로 다시 채운다
    // (기사차량이 1대뿐이면 그 차량 정보로, 여러 대면 차주가 직접 고를 때까지 비워 둔다).
    linkedDriverFormAutoFilledVehicle = null;
    initializeLinkedDriverInvitationForm();
    // linkedDriverEditId를 방금 비웠으니 "할당 차량" 자동완성도 새 초대 기준으로 다시 계산한다
    // — 그러지 않으면 방금까지 수정 중이던 초대의 차량 제외 예외가 계속 남아있게 된다.
    populateLinkedDriverVehicleOptions();
}

// ---------- 차량 관리 ↔ 기사연동 기사 기본정보 자동입력 ----------
// 목적: 차주가 "차량 관리 → 기사차량 등록"에서 이미 입력한 기사명/연락처를 "기사연동 관리"
// 화면에서 다시 입력하지 않아도 되게 한다. Supabase/초대코드/RLS 등 기존 연동 로직은
// 전혀 건드리지 않고, settings.cars에 이미 있는 값을 폼 기본값으로 재사용하기만 한다.

// 기사차량(sub)에 저장된 기사 기본정보(이름/연락처)를 우선순위에 따라 뽑아낸다.
// 차량 관리 모달이 최신 필드(car.driverName/driverPhone)에 저장하므로 그것을 우선 쓰고,
// 레거시 데이터 호환을 위해 없으면 car.personalInfo?.driverName/phone까지 폴백한다.
// 둘 다 없으면 빈 값을 그대로 반환한다(임의로 값을 만들어내지 않음).
function getDriverInfoFromCar(car) {
    if (!car) return { driverName: '', driverPhone: '' };
    return {
        driverName: car.driverName || car.personalInfo?.driverName || '',
        driverPhone: car.driverPhone || car.personalInfo?.phone || ''
    };
}

// 마지막으로 자동입력의 기준이 됐던 차량번호. 같은 차량번호에 대해 자동입력을 반복
// 실행하지 않기 위해 기억해 둔다 — 차주가 이름/연락처를 직접 고친 뒤 다른 필드를
// 입력하는 것만으로 다시 원래 값으로 되돌아가는 일이 없게 하기 위함(할당 차량이 실제로
// "바뀔 때"만 다시 채운다).
let linkedDriverFormAutoFilledVehicle = null;

// 할당 차량 입력값(vehicleNumber)이 등록된 기사차량(sub) 번호와 정확히 일치할 때만 그
// 차량의 기사 이름/연락처로 입력란을 채운다. 일치하는 차량이 없으면(입력이 아직 덜
// 끝났거나 등록되지 않은 번호) 아무것도 하지 않는다. options.force가 없으면 직전과
// 같은 차량번호에 대해서는 다시 실행하지 않는다.
function prefillLinkedDriverFromVehicle(vehicleNumber, options = {}) {
    const { force = false } = options;
    if (!vehicleNumber) return false;
    if (!force && linkedDriverFormAutoFilledVehicle === vehicleNumber) return false;

    const settings = getUserSettings();
    const car = (settings.cars || []).find(item => item.type === 'sub' && item.number === vehicleNumber);
    if (!car) return false;

    const info = getDriverInfoFromCar(car);
    const nameInput = document.getElementById('linkedDriverName');
    const phoneInput = document.getElementById('linkedDriverPhone');
    if (nameInput) nameInput.value = info.driverName;
    if (phoneInput) phoneInput.value = info.driverPhone;
    linkedDriverFormAutoFilledVehicle = vehicleNumber;
    return true;
}

// "할당 차량" 입력란(oninput)에서 호출된다. 기존 초대를 수정하는 중(linkedDriverEditId가
// 있음)이면 절대 자동입력하지 않는다 — 자동입력은 "새 초대 작성" 상태에서만 동작해야
// 기존 초대에 저장된 값을 실수로 덮어쓰지 않는다.
function handleLinkedDriverVehicleInput(input) {
    clearFieldError(input);
    const editingId = document.getElementById('linkedDriverEditId')?.value || '';
    if (editingId) return;
    prefillLinkedDriverFromVehicle(input.value.trim());
}

// 기사연동 화면에 "새 초대 작성" 상태로 진입했을 때 실행한다(showDriverConnectionManagement
// 진입 시, resetLinkedDriverForm 실행 시). 이미 수정 중이거나 폼에 뭔가 입력돼 있으면
// 아무것도 하지 않는다. 등록된 기사차량(sub)이 정확히 1대뿐이면 그 차량 정보로 할당
// 차량/이름/연락처를 미리 채워 준다 — 2대 이상이면 어떤 차량인지 임의로 추측하지 않고
// 비워 둔 채로 차주가 직접 고르게 한다(고르는 순간은 handleLinkedDriverVehicleInput이 처리).
function initializeLinkedDriverInvitationForm() {
    const editingId = document.getElementById('linkedDriverEditId')?.value || '';
    if (editingId) return; // 기존 초대 수정 중이면 절대 손대지 않는다.

    const nameInput = document.getElementById('linkedDriverName');
    const phoneInput = document.getElementById('linkedDriverPhone');
    const vehicleInput = document.getElementById('linkedDriverVehicle');
    const inviteCodeInput = document.getElementById('linkedDriverInviteCode');
    if ((nameInput?.value || '') || (phoneInput?.value || '') || (vehicleInput?.value || '')) return;

    // 새 초대 폼이 비어 있는 상태라면 "새로 입력" 버튼과 동일하게 초대 코드부터 준비해 둔다
    // (기존 코드 생성 방식(generateDriverInviteCode)을 그대로 재사용 — 새로 만들지 않음).
    if (inviteCodeInput && !inviteCodeInput.value && typeof generateDriverInviteCode === 'function') {
        generateDriverInviteCode();
    }

    const subCars = (getUserSettings().cars || []).filter(car => car.type === 'sub' && car.number);
    if (subCars.length !== 1) return; // 0대 또는 2대 이상이면 어떤 차량인지 임의로 채우지 않는다.

    const car = subCars[0];
    if (vehicleInput) vehicleInput.value = car.number;
    prefillLinkedDriverFromVehicle(car.number, { force: true });
}

// 초대 저장은 실제로 Supabase에 반영돼야만 의미가 있다(기사가 이 코드로 찾는 대상 자체가
// 그 행이므로) — 그래서 로컬-먼저-저장이 아니라 Supabase 저장을 반드시 기다린 뒤에만 로컬
// driverLinks에 반영한다. 실패하면 로컬은 건드리지 않고 에러를 그대로 던져서(runSaveAction이
// 재시도 모달을 보여줌) 사용자가 "초대는 했는데 실제로는 안 만들어진" 상태를 겪지 않게 한다.
// 기사 초대 저장의 실제 처리(중복 확인 → driver_links upsert → 로컬 driverLinks/차량 반영)만
// 담당하는 공용 함수다. "기사 연동 관리" 화면의 초대 폼(saveLinkedDriverInvitation)과, 차량
// 등록 모달의 2차 기사연동 모달(saveCarDriverInvitation) 양쪽에서 이 함수 하나를 그대로
// 재사용한다 — 기사연동 시스템을 하나 더 만들지 않기 위함. 형식 검증(빈 값/6자리 코드 등)은
// 호출부가 각자의 입력 필드를 대상으로 먼저 하고, 여기서는 그 이후의 공통 로직만 담당한다.
// 실패하면 toast로 이유를 보여준 뒤 null을 반환한다(예외를 던지지 않음).
async function performSaveLinkedDriverInvitation({ name, phone, inviteCode, vehicleNumber, assignmentStart, assignmentEnd, editId }) {
    const settings = getUserSettings();
    const links = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
    const editing = editId ? links.find(link => link.id === editId) : null;

    // 메인 차량(차주 본인 차량)은 기사에게 할당할 수 없다. populateLinkedDriverVehicleOptions()가
    // 자동완성 목록에서 이미 빼두지만, <input list="...">는 자동완성일 뿐 자유 입력을 막지
    // 않으므로(직접 타이핑하면 그대로 통과된다) 실제 저장 시점에도 반드시 한 번 더 막는다.
    const targetCar = (settings.cars || []).find(item => item.number === vehicleNumber);
    if (targetCar?.type === 'main') {
        showToastMessage('메인 차량은 기사에게 할당할 수 없습니다. 기사차량 번호를 입력해 주세요.');
        return null;
    }

    const conflictingLink = findOverlappingDriverLink(links, vehicleNumber, assignmentStart, assignmentEnd, editId);
    if (conflictingLink) {
        showToastMessage(`같은 차량에 ${conflictingLink.driverName || '다른 기사'}의 할당 기간(${conflictingLink.assignmentStart}~${conflictingLink.assignmentEnd || '계속'})과 겹칩니다.`);
        return null;
    }

    const car = (settings.cars || []).find(item => item.number === vehicleNumber);
    if (!car?.supabaseId) {
        showToastMessage('선택한 차량이 아직 클라우드에 동기화되지 않았습니다. 잠시 후 다시 시도해 주세요.');
        return null;
    }

    let serverConflict;
    try {
        // 로컬 캐시뿐 아니라 서버 기준으로도 한 번 더 겹치는 할당이 있는지 확인한다(다른
        // 기기에서 만든 초대까지 포함해서).
        serverConflict = await findOverlappingDriverLinkOnSupabase(car.supabaseId, assignmentStart, assignmentEnd, editing?.supabaseId);
    } catch (error) {
        console.error('기사 연동 중복 확인 실패:', error);
        showToastMessage('사장님 연결에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
        return null;
    }
    if (serverConflict) {
        showToastMessage('같은 차량에 이미 겹치는 기간으로 연결되어 있거나 초대된 기록이 있습니다.');
        return null;
    }

    let savedRow;
    try {
        savedRow = await upsertDriverLinkOnSupabase({
            supabaseId: editing?.supabaseId || null,
            vehicleId: car.supabaseId,
            inviteCode,
            assignmentStart,
            assignmentEnd
        });
    } catch (error) {
        console.error('기사 초대 저장 실패:', error);
        showToastMessage(typeof getDriverLinkErrorMessage === 'function' ? getDriverLinkErrorMessage(error) : '초대 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return null;
    }

    const nextLink = {
        ...(editing || {}),
        id: editing?.id || generateLocalId('driver'),
        supabaseId: savedRow.id,
        driverName: name,
        phone,
        inviteCode: savedRow.invite_code,
        vehicleId: savedRow.vehicle_id,
        vehicleNumber,
        assignmentStart: savedRow.assignment_start,
        assignmentEnd: savedRow.assignment_end,
        status: savedRow.status,
        linkedAt: savedRow.linked_at,
        updatedAt: savedRow.updated_at,
        createdAt: editing?.createdAt || savedRow.created_at
    };

    const existingIndex = links.findIndex(link => link.id === nextLink.id);
    const isNew = existingIndex < 0;
    if (existingIndex >= 0) links[existingIndex] = nextLink;
    else links.push(nextLink);
    settings.driverLinks = links;
    const assignedCar = (settings.cars || []).find(item => item.number === nextLink.vehicleNumber);
    if (assignedCar) {
        assignedCar.driverName = nextLink.driverName;
        assignedCar.driverPhone = nextLink.phone;
    }
    setUserSettings(settings);
    renderSubCarMenu();
    updateAccountRoleUI();
    showToastMessage(isNew ? '기사 초대를 저장했습니다.' : '기사 할당 정보를 수정했습니다.');
    return nextLink;
}

async function saveLinkedDriverInvitation() {
    const name = document.getElementById('linkedDriverName')?.value.trim() || '';
    const phone = document.getElementById('linkedDriverPhone')?.value.trim() || '';
    const inviteCode = document.getElementById('linkedDriverInviteCode')?.value.trim() || '';
    const vehicleNumber = document.getElementById('linkedDriverVehicle')?.value.trim() || '';
    const assignmentStart = document.getElementById('linkedDriverAssignmentStart')?.value || '';
    const assignmentEnd = document.getElementById('linkedDriverAssignmentEnd')?.value || '';
    const editId = document.getElementById('linkedDriverEditId')?.value || '';

    if (!name || !vehicleNumber || !assignmentStart) {
        if (!name) markFieldError('linkedDriverName');
        if (!vehicleNumber) markFieldError('linkedDriverVehicle');
        if (!assignmentStart) markFieldError('linkedDriverAssignmentStart');
        showToastMessage('기사 이름, 할당 차량, 시작일을 입력해 주세요.');
        return;
    }
    if (!/^\d{6}$/.test(inviteCode)) {
        markFieldError('linkedDriverInviteCode');
        showToastMessage('"코드 생성" 버튼으로 6자리 초대 코드를 만들어 주세요.');
        return;
    }
    if (assignmentEnd && assignmentEnd < assignmentStart) {
        showToastMessage('할당 종료일은 시작일 이후로 선택해 주세요.');
        return;
    }

    const link = await performSaveLinkedDriverInvitation({ name, phone, inviteCode, vehicleNumber, assignmentStart, assignmentEnd, editId });
    if (!link) return; // 실패 이유는 이미 toast로 표시됨

    resetLinkedDriverForm();
    renderLinkedDriverList();
}

function getLinkedDriverById(id) {
    return (getUserSettings().driverLinks || []).find(link => link.id === id) || null;
}

function editLinkedDriver(encodedId) {
    const link = getLinkedDriverById(decodeURIComponent(encodedId));
    if (!link) return;
    document.getElementById('linkedDriverEditId').value = link.id;
    document.getElementById('linkedDriverName').value = link.driverName || '';
    document.getElementById('linkedDriverPhone').value = link.phone || '';
    document.getElementById('linkedDriverInviteCode').value = link.inviteCode || '';
    document.getElementById('linkedDriverVehicle').value = link.vehicleNumber || '';
    document.getElementById('linkedDriverAssignmentStart').value = link.assignmentStart || '';
    document.getElementById('linkedDriverAssignmentEnd').value = link.assignmentEnd || '';
    document.getElementById('linkedDriverSaveBtn').textContent = link.status === 'linked' ? '할당 정보 저장' : '초대 수정';
    // linkedDriverEditId가 방금 이 초대의 id로 바뀌었으니, "할당 차량" 자동완성도 다시
    // 계산한다 — 안 그러면 이 초대 자신의 차량이 "이미 다른 초대에 활성 할당됨"으로 오인돼
    // 자동완성 목록에서 빠져 있는 상태로 남는다.
    populateLinkedDriverVehicleOptions();
    document.querySelector('.driver-invite-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 상태 변경(해제/재초대 등)은 초대 생성과 달리 되돌릴 수 있고 급하지 않은 작업이라
// 다른 저장 로직처럼 로컬을 먼저 반영하고 Supabase 반영은 백그라운드(best-effort)로 돌린다.
function updateLinkedDriverStatus(id, status, message) {
    const settings = getUserSettings();
    const link = (settings.driverLinks || []).find(item => item.id === id);
    if (!link) return;
    link.status = status;
    link.updatedAt = new Date().toISOString();
    if (status === 'linked') link.linkedAt = new Date().toISOString();
    setUserSettings(settings);
    renderLinkedDriverList();
    renderSubCarMenu();
    updateAccountRoleUI();
    if (message) showToastMessage(message);

    if (link.supabaseId && typeof updateDriverLinkStatusOnSupabase === 'function') {
        updateDriverLinkStatusOnSupabase(link.supabaseId, status).catch(error => {
            console.error('기사 연동 상태 서버 반영 실패:', error);
        });
    }
}

// "연결 완료"는 더 이상 차주가 스스로 누르는 버튼이 아니다(실제 연결은 기사가 코드를
// 입력해야만 서버에서 일어난다). 이 버튼은 그 대신 서버 상태를 다시 확인해서 반영한다.
async function refreshLinkedDriverConnection(encodedId) {
    if (typeof syncDriverLinksFromSupabase === 'function') {
        await syncDriverLinksFromSupabase();
    }
    renderLinkedDriverList();
    renderSubCarMenu();
    updateAccountRoleUI();
    const link = getLinkedDriverById(decodeURIComponent(encodedId));
    if (link?.status === 'linked') showToastMessage('기사와 연결이 확인되었습니다.');
    else showToastMessage('아직 기사가 초대 코드를 입력하지 않았습니다.');
}

function disconnectLinkedDriver(encodedId) {
    const id = decodeURIComponent(encodedId);
    showConfirmModal('기사 연동을 해제하시겠습니까? 기존 기록은 삭제되지 않습니다.', () => {
        updateLinkedDriverStatus(id, 'disconnected', '기사 연동을 해제했습니다.');
    });
}

function renewLinkedDriverInvitation(encodedId) {
    updateLinkedDriverStatus(decodeURIComponent(encodedId), 'pending', '기사 초대를 다시 열었습니다.');
}

function deleteLinkedDriver(encodedId) {
    const id = decodeURIComponent(encodedId);
    showConfirmModal('해제된 기사 연결 항목을 목록에서 삭제하시겠습니까?', () => {
        const settings = getUserSettings();
        const link = (settings.driverLinks || []).find(item => item.id === id);
        settings.driverLinks = (settings.driverLinks || []).filter(item => item.id !== id);
        setUserSettings(settings);
        renderLinkedDriverList();
        renderSubCarMenu();
        updateAccountRoleUI();
        showToastMessage('기사 연결 항목을 삭제했습니다.');

        if (link?.supabaseId && typeof deleteDriverLinkOnSupabase === 'function') {
            deleteDriverLinkOnSupabase(link.supabaseId).catch(error => {
                console.error('기사 연동 삭제 서버 반영 실패:', error);
            });
        }
    });
}

function renderLinkedDriverList() {
    const settings = getUserSettings();
    const links = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
    const list = document.getElementById('linkedDriverList');
    if (!list) return;
    const activeCount = links.filter(link => link.status === 'linked').length;
    const pendingCount = links.filter(link => link.status === 'pending').length;
    document.getElementById('linkedDriverActiveCount').textContent = activeCount;
    document.getElementById('linkedDriverPendingCount').textContent = pendingCount;

    if (!links.length) {
        list.innerHTML = '<div class="linked-driver-empty">연결된 기사가 없습니다.<br>위에서 기사 초대와 차량 할당을 등록해 주세요.</div>';
        return;
    }

    list.innerHTML = links.map(link => {
        const encodedId = encodeURIComponent(link.id);
        const statusLabel = link.status === 'linked' ? '연동 중' : link.status === 'pending' ? '초대 대기' : '연동 해제';
        const assignment = getAssignmentState(link);
        const period = `${link.assignmentStart || '-'} ~ ${link.assignmentEnd || '계속'}`;
        const connection = [link.phone, link.inviteCode ? `코드 ${link.inviteCode}` : ''].filter(Boolean).join(' · ');
        let actions = '';
        if (link.status === 'pending') {
            actions = `<button type="button" class="primary" onclick="runSaveAction(this, 'driver-refresh-${encodedId}', () => refreshLinkedDriverConnection('${encodedId}'))">연결 상태 확인</button><button type="button" onclick="editLinkedDriver('${encodedId}')">초대 수정</button><button type="button" class="danger" onclick="disconnectLinkedDriver('${encodedId}')">초대 취소</button>`;
        } else if (link.status === 'linked') {
            actions = `<button type="button" class="primary" onclick="showLinkedDriverManagement('${encodedId}', true)">기록 조회</button><button type="button" onclick="editLinkedDriver('${encodedId}')">할당 변경</button><button type="button" class="danger" onclick="disconnectLinkedDriver('${encodedId}')">연동 해제</button>`;
        } else {
            actions = `<button type="button" onclick="renewLinkedDriverInvitation('${encodedId}')">다시 초대</button><button type="button" onclick="editLinkedDriver('${encodedId}')">정보 수정</button><button type="button" class="danger" onclick="deleteLinkedDriver('${encodedId}')">삭제</button>`;
        }
        return `<article class="linked-driver-card"><div class="linked-driver-card-head"><div><strong>${escapeDetailText(link.driverName || '기사')}</strong><span>${escapeDetailText(connection || '연결 정보 없음')}</span></div><em class="${link.status}">${statusLabel}</em></div><div class="linked-driver-assignment"><span><small>할당 차량</small><b>${escapeDetailText(link.vehicleNumber || '-')}</b></span><span><small>할당 기간</small><b>${escapeDetailText(period)}</b></span></div><div class="linked-driver-state ${assignment.key}">${assignment.label}</div><div class="linked-driver-card-actions">${actions}</div></article>`;
    }).join('');
}

function getLinkedRecordSummary(record) {
    const details = Array.isArray(record?.callDetails) ? record.callDetails : [];
    const fixedCount = Number(record?.fixedCount || record?.count || 0);
    const detailFare = details.reduce((sum, item) => sum + parseCurrencyValue(item?.fare), 0);
    const directFare = parseCurrencyValue(record?.fare || record?.fixedFare || record?.totalFare);
    const count = fixedCount + details.length || (record && Object.keys(record).length ? 1 : 0);
    return { details, count, fare: detailFare + directFare };
}

// ---------- 기사 정산 상세 / 거래처별 세금계산서 (차주가 연동 기사 화면에서 보는 것) ----------
// 핵심 원칙: "기사 정산"(차주가 기사에게 지급할 금액)과 "거래처별 세금계산서"(기사가 실제
// 운송한 거래처 매출)는 서로 다른 업무이지만, 반드시 같은 원본 데이터(연동 기사의 실제
// daily_logs/transport_details, fetchLinkedDriverRecordData가 이미 가져온 data)에서 파생돼야
// 한다 — 그래야 "정산 상세 합계 = 총 운송료", "거래처별 합계 합 = 총 운송료(고정노선 제외)"가
// 항상 성립한다. 두 함수 모두 같은 data를 입력받아 서로 다른 관점으로만 가공한다.

// 연동 기사의 월간 운행 기록(data)을 건별로 펼친다. "콜상세"(callDetails)는 거래처/상차지/
// 하차지가 있는 개별 운송 건이고, "고정노선"(fixedCount/fixedFare)은 그런 세부 항목이 없는
// 월정액성 운행이라 거래처별로 쪼갤 수 없다 — 없는 정보를 임의로 만들지 않고 type:'fixed'로
// 구분해서 그대로 보여준다(운송 상세내역 합계가 기사 정산 총액과 반드시 같아야 하므로 누락
// 없이 전부 포함한다).
function flattenLinkedDriverTrips(data, monthKey, link) {
    const trips = [];
    Object.entries(data || {}).forEach(([dateKey, record]) => {
        if (!dateKey.startsWith(monthKey) || !record || typeof record !== 'object' || record.isOff) return;
        if (!isDateWithinAssignment(dateKey, link?.assignmentStart, link?.assignmentEnd)) return;

        (Array.isArray(record.callDetails) ? record.callDetails : []).forEach(detail => {
            const workDate = detail.workDate || dateKey;
            if (!workDate.startsWith(monthKey) || !isDateWithinAssignment(workDate, link?.assignmentStart, link?.assignmentEnd)) return;
            trips.push({
                type: 'call',
                dateKey: workDate,
                client: (detail.client || '').trim(),
                loadLoc: detail.loadLoc || '',
                unloadLoc: detail.unloadLoc || '',
                fare: parseCurrencyValue(detail.fare),
                vatExempt: !!detail.vatExempt,
                platform: detail.platform || '',
                distanceKm: detail.distanceKm || '',
                cargoTonnage: detail.cargoTonnage || '',
                paymentDueDate: detail.paymentDueDate || '',
                remarks: detail.remarks || ''
            });
        });

        const fixedCount = Number(record.fixedCount || record.count || 0);
        const fixedFare = parseCurrencyValue(record.fare || record.fixedFare || record.totalFare);
        if (fixedCount > 0 || fixedFare > 0) {
            trips.push({ type: 'fixed', dateKey, client: '', loadLoc: '', unloadLoc: '', fare: fixedFare, vatExempt: false, fixedCount });
        }
    });
    return trips.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

// 기사 정산(§A) 계산 — 기존 getMonthlyDriverTotals/calculateDriverVehicleCommission을 그대로
// 재사용한다(새 계산식을 따로 만들지 않음). trips는 위 flattenLinkedDriverTrips의 결과를 그대로
// 붙여서, "이 총액이 왜 이 금액인지" 검증할 수 있는 근거 목록으로 함께 반환한다.
function getLinkedDriverSettlementDetail(data, monthKey, link, car) {
    const totals = getMonthlyDriverTotals(data, monthKey, link);
    const commissionAmount = calculateDriverVehicleCommission(car, totals.grossAmount, totals.count);
    const insuranceAmount = car?.insuranceOn ? totals.insuranceAmount : 0;
    const finalAmount = Math.max(0, totals.grossAmount - commissionAmount - insuranceAmount);
    const trips = flattenLinkedDriverTrips(data, monthKey, link);
    return {
        totalFare: totals.grossAmount,
        tripCount: totals.count,
        commissionAmount,
        insuranceAmount,
        finalAmount,
        trips,
        tripsFareSum: trips.reduce((sum, t) => sum + t.fare, 0)
    };
}

// 거래처별 세금계산서(§B) 집계 — "콜상세" 운송 건만 대상이다(거래처가 있어야 계산서를 만들
// 수 있으므로). 거래처가 비어있는 건은 계산서 대상에 넣지 않고 별도로 카운트만 한다(§18 —
// "미지정 거래처"를 임의로 계산서 대상으로 만들지 않음). 공급자는 이 차량의 사업자정보
// (getCarBusinessInfo — "내 사업자와 동일"이면 차주 기본 사업자)를 그대로 재사용한다.
function getLinkedDriverClientInvoiceGroups(trips, car, ownerSettings) {
    const supplier = getVehicleSupplierIdentity(car, ownerSettings);
    const grouped = {};
    let unassignedCount = 0;
    trips.filter(t => t.type === 'call').forEach(trip => {
        if (!trip.client) { unassignedCount += 1; return; }
        if (trip.fare <= 0) return;
        const key = trip.client;
        if (!grouped[key]) grouped[key] = { clientName: trip.client, count: 0, supplyAmount: 0, taxAmount: 0, trips: [] };
        grouped[key].count += 1;
        grouped[key].supplyAmount += trip.fare;
        grouped[key].taxAmount += trip.vatExempt ? 0 : Math.round(trip.fare * .1);
        grouped[key].trips.push(trip);
    });
    const groups = Object.values(grouped).map(g => ({ ...g, totalAmount: g.supplyAmount + g.taxAmount, supplierBiz: supplier.biz, vehicleLabel: supplier.carLabel }));
    return { groups, unassignedCount };
}

function showLinkedDriverManagement(id, encoded = false) {
    const linkId = encoded ? decodeURIComponent(id) : id;
    const link = getLinkedDriverById(linkId);
    if (!link || link.status !== 'linked') {
        showToastMessage('연동 중인 기사 정보를 찾을 수 없습니다.');
        return;
    }
    activeLinkedDriverId = link.id;
    linkedDriverTripDetailOpen = false;
    hideAllPages();
    document.getElementById('linkedDriverManagementPage').classList.remove('hidden');
    document.getElementById('linkedDriverManagementTitle').textContent = `${getShortCarNum(link.vehicleNumber)} 관리`;
    const assignment = getAssignmentState(link);
    document.getElementById('linkedDriverProfileCard').innerHTML = `<div><span class="linked-driver-avatar">${escapeDetailText((link.driverName || '기').slice(0, 1))}</span><span><strong>${escapeDetailText(link.driverName || '기사')}</strong><small>${escapeDetailText(link.phone || '연락처 없음')}</small></span></div><div><span>${escapeDetailText(link.vehicleNumber || '차량 미지정')}</span><em class="${assignment.key}">${assignment.label}</em></div>`;
    const monthInput = document.getElementById('linkedDriverRecordMonth');
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    renderLinkedDriverRecords();
    setActiveNav('main');

    // 거래처 세금계산서 공유 권한은 기사가 언제든 켜고 끌 수 있으므로, 화면에 들어올 때마다
    // 서버 기준으로 다시 확인한다(§21 — 다음 화면 진입/새로고침 시 즉시 반영).
    if (typeof syncDriverLinksFromSupabase === 'function') {
        syncDriverLinksFromSupabase().then(() => {
            if (activeLinkedDriverId === link.id && !document.getElementById('linkedDriverManagementPage')?.classList.contains('hidden')) {
                renderLinkedDriverRecords();
            }
        });
    }
}

// "운송 상세내역 보기" 펼침 상태(§2) — 기사 정산 총액의 근거 목록을 기본은 접어 두고,
// 필요할 때만 펼쳐서 본다.
let linkedDriverTripDetailOpen = false;
function toggleLinkedDriverTripDetail() {
    linkedDriverTripDetailOpen = !linkedDriverTripDetailOpen;
    document.getElementById('linkedDriverRecordList')?.classList.toggle('hidden', !linkedDriverTripDetailOpen);
    const btn = document.getElementById('linkedDriverTripDetailToggleBtn');
    if (btn) btn.textContent = linkedDriverTripDetailOpen ? '운송 상세내역 접기' : '운송 상세내역 보기';
}

// 거래처 카드 펼침/접힘(§16) — 카드마다 독립적으로 상세 운송 건을 열어볼 수 있다.
let linkedDriverOpenClientKeys = new Set();
function toggleLinkedDriverClientDetail(encodedKey) {
    const key = decodeURIComponent(encodedKey);
    if (linkedDriverOpenClientKeys.has(key)) linkedDriverOpenClientKeys.delete(key);
    else linkedDriverOpenClientKeys.add(key);
    document.getElementById(`linkedClientTrips_${encodedKey}`)?.classList.toggle('hidden', !linkedDriverOpenClientKeys.has(key));
}

// 연동된 기사가 실제로 작성한 운행 기록을 Supabase(daily_logs+transport_details)에서
// vehicle_id 기준으로 직접 조회한다. 예전에는 같은 브라우저의 localStorage만 봐서 다른
// 기기에서 작성한 기록은 절대 보이지 않았다 — 이제 그 차량으로 기록된 실제 서버 데이터를 본다.
async function fetchLinkedDriverRecordData(link) {
    if (!link?.vehicleId || typeof getSupabaseClient !== 'function') return {};
    try {
        const client = await getSupabaseClient();
        const [dailyRes, detailsRes] = await Promise.all([
            client.from('daily_logs').select('work_date, raw, fixed_count, pallet_count, is_off').eq('vehicle_id', link.vehicleId),
            client.from('transport_details').select('work_date, raw').eq('vehicle_id', link.vehicleId)
        ]);
        if (dailyRes.error) throw dailyRes.error;
        if (detailsRes.error) throw detailsRes.error;

        const byDate = {};
        (dailyRes.data || []).forEach(row => {
            byDate[row.work_date] = {
                ...(row.raw && typeof row.raw === 'object' ? row.raw : {}),
                isOff: !!row.is_off,
                fixedCount: row.fixed_count || 0,
                palletCount: row.pallet_count || 0,
                callDetails: []
            };
        });
        (detailsRes.data || []).forEach(row => {
            if (byDate[row.work_date]) byDate[row.work_date].callDetails.push(row.raw && typeof row.raw === 'object' ? row.raw : {});
        });
        return byDate;
    } catch (error) {
        console.error('연동 기사 운행 기록 조회 실패:', error);
        return {};
    }
}

async function renderLinkedDriverRecords() {
    const link = getLinkedDriverById(activeLinkedDriverId);
    const list = document.getElementById('linkedDriverRecordList');
    if (!link || !list) return;
    list.innerHTML = '<div class="linked-driver-empty">불러오는 중...</div>';
    const month = document.getElementById('linkedDriverRecordMonth')?.value || '';
    const data = await fetchLinkedDriverRecordData(link);
    // 조회하는 동안 화면을 벗어났거나 다른 기사로 바뀌었으면 반영하지 않는다.
    if (getLinkedDriverById(activeLinkedDriverId)?.id !== link.id || document.getElementById('linkedDriverManagementPage')?.classList.contains('hidden')) return;

    const ownerSettings = getUserSettings();
    const car = (ownerSettings.cars || []).find(c => c.number === link.vehicleNumber) || null;

    // ---------- 기사 정산 (항상 표시, §9/§13/§19) ----------
    const detail = getLinkedDriverSettlementDetail(data, month, link, car);
    document.getElementById('linkedDriverRecordCount').textContent = `${detail.tripCount}건`;
    document.getElementById('linkedDriverRecordFare').textContent = `${detail.totalFare.toLocaleString()}원`;
    document.getElementById('linkedDriverCommissionAmount').textContent = `-${detail.commissionAmount.toLocaleString()}원`;
    document.getElementById('linkedDriverInsuranceAmount').textContent = `-${detail.insuranceAmount.toLocaleString()}원`;
    document.getElementById('linkedDriverFinalAmount').textContent = `${detail.finalAmount.toLocaleString()}원`;

    if (!detail.trips.length) {
        list.innerHTML = '<div class="linked-driver-empty">선택한 달에 작성된 운행 기록이 없습니다.</div>';
    } else {
        list.innerHTML = detail.trips.map(trip => {
            const [, monthPart, dayPart] = trip.dateKey.split('-');
            const dateLabel = `${parseInt(monthPart, 10)}월 ${parseInt(dayPart, 10)}일`;
            if (trip.type === 'fixed') {
                return `<article class="linked-driver-record-card"><div><strong>${dateLabel}</strong><span>고정노선 ${trip.fixedCount || ''}건</span></div><p>거래처/상하차지 구분 없는 고정노선 운행입니다.</p><b>${trip.fare.toLocaleString()}원</b></article>`;
            }
            const badges = [
                trip.platform ? `플랫폼 ${trip.platform}` : '',
                trip.distanceKm ? `${trip.distanceKm}km` : '',
                trip.cargoTonnage ? `${trip.cargoTonnage}` : '',
                trip.paymentDueDate ? `입금예정 ${trip.paymentDueDate}` : '',
                trip.vatExempt ? '부가세 면세' : ''
            ].filter(Boolean).join(' · ');
            return `<article class="linked-driver-record-card"><div><strong>${dateLabel}</strong><span>${escapeDetailText(trip.client || '거래처 미지정')}</span></div><p>${escapeDetailText(trip.loadLoc || '상차지')} → ${escapeDetailText(trip.unloadLoc || '하차지')}${badges ? `<br><small>${escapeDetailText(badges)}</small>` : ''}${trip.remarks ? `<br><small>${escapeDetailText(trip.remarks)}</small>` : ''}</p><b>${trip.fare.toLocaleString()}원</b></article>`;
        }).join('');
    }

    // ---------- 거래처별 세금계산서 (기사 공유 ON일 때만, §6~9/§21) ----------
    const invoiceArea = document.getElementById('linkedDriverClientInvoiceArea');
    if (!invoiceArea) return;
    if (!isSharingClientTaxInvoicesWithOwner(link)) {
        invoiceArea.innerHTML = '<div class="linked-driver-empty">기사의 거래처 세금계산서 공유가 설정되어 있지 않습니다.</div>';
        return;
    }
    const { groups, unassignedCount } = getLinkedDriverClientInvoiceGroups(detail.trips, car, ownerSettings);
    if (!groups.length) {
        invoiceArea.innerHTML = `<div class="linked-driver-empty">선택한 달에 거래처가 연결된 운송 기록이 없습니다.${unassignedCount ? ` (거래처 미지정 운행 ${unassignedCount}건)` : ''}</div>`;
        return;
    }
    invoiceArea.innerHTML = (unassignedCount ? `<p class="linked-driver-readonly-notice" style="margin-bottom:8px;"><span>거래처 미지정 운행 ${unassignedCount}건은 계산서 대상에서 제외됐습니다.</span></p>` : '')
        + groups.map(g => {
            const key = encodeURIComponent(g.clientName);
            // vehicleLabel에 이미 "사업자명 · 차량번호"가 포함돼 있으므로(별도 사업자 차량의
            // 경우) 이름을 또 붙이면 중복 표시된다 — vehicleLabel 하나만 쓴다.
            const supplierLabel = g.vehicleLabel || g.supplierBiz?.name || '';
            const tripRows = g.trips.map(t => `<div class="linked-driver-client-trip-row"><span>${escapeDetailText(t.dateKey.slice(5).replace('-', '/'))} ${escapeDetailText(t.loadLoc || '상차지')} → ${escapeDetailText(t.unloadLoc || '하차지')}</span><b>${t.fare.toLocaleString()}원</b></div>`).join('');
            return `<article class="tax-invoice-card">
                <div class="tax-invoice-card-head"><div><strong>${escapeDetailText(g.clientName)}</strong><span>${g.count}건${supplierLabel ? ` · ${escapeDetailText(supplierLabel)}` : ''}</span></div></div>
                <div class="tax-invoice-card-money"><span>공급가액 <b>${g.supplyAmount.toLocaleString()}원</b></span><span>세액 <b>${g.taxAmount.toLocaleString()}원</b></span><strong><small>합계</small>${g.totalAmount.toLocaleString()}원</strong></div>
                <div class="tax-invoice-card-actions single-action"><button type="button" onclick="toggleLinkedDriverClientDetail('${key}')">상세보기</button></div>
                <div id="linkedClientTrips_${key}" class="linked-driver-client-trip-list hidden">${tripRows}</div>
            </article>`;
        }).join('');
}

function renderEmployedDriverLinkState() {
    const settings = getUserSettings();
    const linked = settings.employerLink?.status === 'linked';
    document.getElementById('employedDriverDisconnectedPanel')?.classList.toggle('hidden', linked);
    document.getElementById('employedDriverConnectedPanel')?.classList.toggle('hidden', !linked);
    if (!linked) return;
    document.getElementById('employerLinkedName').textContent = settings.employerLink.ownerName || '연동된 운송사';
    document.getElementById('employerLinkedMeta').textContent = [settings.employerLink.ownerPhone, settings.employerLink.inviteCode ? `초대 코드 ${settings.employerLink.inviteCode}` : ''].filter(Boolean).join(' · ');
    const shareToggle = document.getElementById('shareClientTaxInvoicesToggle');
    if (shareToggle) shareToggle.checked = isSharingClientTaxInvoicesWithOwner(settings);
}

// 기사 → 차주 "거래처별 세금계산서 공유" 권한. 차주가 차량 설정에서 켜는 "기사 월매출 조회"
// (shareRevenueWithOwner, 기본 ON)와는 완전히 다른 별개의 값이다 — 이건 기사 본인이 켜고 끄는
// 권한이고, 기본값은 개인정보 보호 원칙상 OFF다(값이 아예 없는 기존 기사 계정도 OFF로 취급).
function isSharingClientTaxInvoicesWithOwner(settingsOrLink) {
    return settingsOrLink?.shareClientTaxInvoicesWithOwner === true;
}

// profiles.settings(jsonb)에 실려서 기존 동기화 경로(setUserSettings → scheduleSupabaseSettingsSync
// → syncSettingsToSupabase → buildSettingsJsonbPayload)로 그대로 서버에 저장된다 — 이 값만을
// 위한 새 컬럼이나 새 동기화 로직을 따로 만들지 않는다. 차주 쪽은 이 값을 로컬(다른 사람의
// localStorage)이 아니라 서버(연동된 기사의 profiles.settings)에서 읽어 판단한다
// (syncDriverLinksFromSupabase 참고).
function toggleShareClientTaxInvoicesWithOwner(checked) {
    const settings = getUserSettings();
    settings.shareClientTaxInvoicesWithOwner = !!checked;
    setUserSettings(settings);
    showToastMessage(checked ? '거래처 세금계산서 공유를 켰습니다.' : '거래처 세금계산서 공유를 껐습니다.');
}

// 실제 연결은 서버(redeem_driver_invite_code RPC)에서만 일어난다 — 전화번호만으로는
// 아직 실제로 연결해 주는 수단이 없으므로(차주 쪽에서 코드 없이 검색할 방법이 없음),
// 반드시 6자리 초대 코드가 있어야 진행한다.
async function connectEmployedDriver() {
    const inviteCode = document.getElementById('employerInviteCode')?.value.trim() || '';
    const ownerPhone = document.getElementById('employerPhone')?.value.trim() || '';
    if (!inviteCode && !ownerPhone) {
        showToastMessage('사장님께 받은 초대 코드를 입력해 주세요.');
        return;
    }
    if (!/^\d{6}$/.test(inviteCode)) {
        showToastMessage('사장님께 받은 6자리 초대 코드를 정확히 입력해 주세요.');
        return;
    }

    try {
        await performEmployedDriverConnect(inviteCode, ownerPhone);
    } catch (error) {
        console.error('기사 연동 실패:', error);
        showToastMessage(getDriverLinkErrorMessage(error));
        return;
    }

    renderEmployedDriverLinkState();
    showToastMessage('소속 사장님과 연결했습니다.');
}

// "기사 연결"의 실제 처리 로직만 담당한다(redeem → 차주 이름 조회 → employerLink 저장 →
// 사업자/차량정보 자동반영 → 과거 기록 backfill). 인증(로그인/회원가입)과는 완전히 분리된
// 별도 단계로, 마이페이지의 "소속 연결하기" 버튼(connectEmployedDriver)과 회원가입 직후
// 자동 연결 시도(executeSignupAction) 양쪽에서 이 함수 하나를 그대로 재사용한다.
// 실패하면 예외를 던지기만 할 뿐 계정/로그인 상태에는 전혀 손대지 않는다 — 호출부가 각자
// 상황에 맞는 안내만 보여주면 된다(연결 실패가 로그인/회원가입 성공을 무효화하지 않음).
async function performEmployedDriverConnect(inviteCode, ownerPhone = '') {
    if (typeof redeemDriverInviteCode !== 'function') {
        throw new Error('연결 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
    const linkedRow = await redeemDriverInviteCode(inviteCode);

    // 연결 자체는 이미 완료됐으니, 상대방(차주) 이름 조회가 실패해도 연결 결과는 그대로 살린다.
    let ownerName = '연동된 운송사';
    let ownerPhoneResolved = ownerPhone;
    try {
        const client = await getSupabaseClient();
        const { data: ownerProfile } = await client.from('profiles').select('name, phone, business_name').eq('id', linkedRow.owner_id).maybeSingle();
        if (ownerProfile) {
            ownerName = ownerProfile.business_name || ownerProfile.name || ownerName;
            ownerPhoneResolved = ownerProfile.phone || ownerPhoneResolved;
        }
    } catch (error) {
        console.error('연동된 차주 정보 조회 실패(연결 자체는 완료됨):', error);
    }

    const settings = getUserSettings();
    settings.employerLink = {
        id: linkedRow.id,
        supabaseId: linkedRow.id,
        status: 'linked',
        ownerId: linkedRow.owner_id,
        ownerName,
        ownerPhone: ownerPhoneResolved,
        inviteCode,
        vehicleId: linkedRow.vehicle_id,
        linkedAt: linkedRow.linked_at || new Date().toISOString()
    };
    setUserSettings(settings);

    // 차주가 이미 차량관리/사업자정보에 입력해둔 값을 기사 쪽에도 그대로 채워 넣어서
    // 같은 정보를 두 번 입력하지 않게 한다(기사 개인정보 — 이름/연락처/계좌 — 는 그대로 둠).
    await applyEmployerAutoFilledInfo(linkedRow.owner_id, linkedRow.vehicle_id);

    // 연동 "이전"에 이미 이 기기에 기록해둔 과거 운행 기록(오늘 이전 것 포함)도 차주가
    // 볼 수 있게, 지금 시점에 전부 차주 소유 차량으로 다시 업로드한다. 안 이러면 연동 이후에
    // 새로 쓴 기록만 보이고 과거 기록은 영원히 안 보인다.
    if (typeof backfillDriverWorkDataToOwnerVehicle === 'function') {
        try {
            const { count } = await backfillDriverWorkDataToOwnerVehicle(linkedRow.vehicle_id);
            if (count > 0) showToastMessage(`이전에 작성한 운행 기록 ${count}건도 사장님께 함께 반영했습니다.`);
        } catch (error) {
            console.error('과거 운행기록 반영 실패(연결 자체는 완료됨):', error);
        }
    }

    return linkedRow;
}

// 이미 연동돼 있는 기사가 "과거 기록 다시 동기화"를 눌렀을 때 쓴다. 연동 시점에 자동으로
// 한 번 돌긴 하지만, 그 전에 실패했거나(오프라인 등) 이 업데이트 이전에 이미 연동해둔
// 계정을 위해 수동으로 다시 실행할 수 있게 남겨둔다.
async function resyncEmployedDriverWorkData() {
    const settings = getUserSettings();
    const vehicleId = settings.employerLink?.vehicleId;
    if (settings.employerLink?.status !== 'linked' || !vehicleId) {
        showToastMessage('연동된 사장님이 없습니다.');
        return;
    }
    if (typeof backfillDriverWorkDataToOwnerVehicle !== 'function') {
        showToastMessage('동기화 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }
    const { count, failed } = await backfillDriverWorkDataToOwnerVehicle(vehicleId);
    if (failed > 0) {
        showToastMessage(`${count}건 반영, ${failed}건은 실패했습니다. 잠시 후 다시 시도해 주세요.`);
    } else if (count > 0) {
        showToastMessage(`운행 기록 ${count}건을 사장님께 다시 반영했습니다.`);
    } else {
        showToastMessage('반영할 운행 기록이 없습니다.');
    }
}

// 기사가 차주와 연동되면 차주가 입력한 사업자정보/차량정보를 기사 쪽 화면에도 자동으로
// 채운다. 기사 본인의 개인정보(이름/연락처/은행계좌)는 절대 건드리지 않는다 — 그건 말
// 그대로 기사 개인의 정보이기 때문이다. 연동 직후 1회, 그리고 개인정보 화면을 열 때마다
// (showPersonalInfo에서) 최신값으로 다시 채운다.
// 기사 개인정보 화면에 자동으로 채워 넣는 "회사 사업자정보"의 원본은 차주의 대표 사업자가
// 아니라 이 기사가 지금 연결돼 있는 차량의 사업자정보다(그 차량이 "내 사업자와 동일"이면
// 결과적으로 차주 기본 사업자와 같아진다) — resolveVehicleBusinessInfoFromSupabase()가 그
// 판단을 서버 기준으로 대신해 준다. 이전에는 여기서 무조건 ownerProfile.business_*만
// 읽어서, 차량별로 다른 사업자를 설정해도 기사 쪽엔 항상 차주 기본 사업자만 반영되고,
// 차량 사업자를 수정해도 반영되지 않는 문제가 있었다.
async function applyEmployerAutoFilledInfo(ownerId, vehicleId) {
    if (!ownerId || typeof getSupabaseClient !== 'function') return;
    try {
        const client = await getSupabaseClient();
        const { biz, vehicleRow } = typeof resolveVehicleBusinessInfoFromSupabase === 'function'
            ? await resolveVehicleBusinessInfoFromSupabase(client, vehicleId, ownerId)
            : { biz: null, vehicleRow: null };

        const settings = getUserSettings();
        let changed = false;
        const changedBizFields = {};

        if (biz) {
            const bizFieldMap = {
                bizName: biz.name,
                bizNumber: biz.bizNumber,
                bizAddress: biz.address,
                bizType: biz.bizType,
                bizItem: biz.bizItem,
                bizEmail: biz.email
            };
            Object.entries(bizFieldMap).forEach(([key, value]) => {
                if (value && settings[key] !== value) { settings[key] = value; changed = true; changedBizFields[key] = value; }
            });
        }

        const vehicle = vehicleRow;
        if (vehicle) {
            const cars = Array.isArray(settings.cars) ? settings.cars : [];
            let mainCar = cars.find(c => c.type === 'main');
            if (!mainCar) {
                mainCar = { type: 'main' };
                cars.push(mainCar);
                changed = true;
            }
            if (vehicle.number && mainCar.number !== vehicle.number) { mainCar.number = vehicle.number; changed = true; }
            if (vehicle.tonnage && mainCar.tonnage !== vehicle.tonnage) { mainCar.tonnage = vehicle.tonnage; changed = true; }
            settings.cars = cars;
        }

        if (changed) {
            setUserSettings(settings);
            // 여기서 loadSettings()(개인정보 화면의 모든 입력란을 localStorage 스냅샷으로
            // 통째로 되돌리는 함수)를 부르지 않는다 — 이 함수는 showPersonalInfo()에서 화면이
            // 이미 열려 있는 동안 비동기(네트워크 조회 후)로 실행되므로, 그 사이 사용자가 이름/
            // 전화번호/계좌 같은 다른 입력란에 뭔가 입력하고 있었다면 방금 타이핑한 내용이
            // 화면에서 통째로 사라지는 문제가 있었다(실제로 보고됨 — "개인정보를 입력해도
            // 계속 지워진다"). 이 함수가 실제로 바꾼 사업자정보 입력란만 직접 갱신하고, 지금
            // 사용자가 포커스를 두고 있는 입력란은(그 필드 자체라도) 건드리지 않는다.
            Object.entries(changedBizFields).forEach(([key, value]) => {
                const el = document.getElementById(key);
                if (el && document.activeElement !== el) el.value = value;
            });
        }
    } catch (error) {
        console.error('차주 사업자정보/차량정보 자동입력 실패:', error);
    }
}

function disconnectEmployedDriver() {
    showConfirmModal('소속 연동을 해제하시겠습니까? 작성한 운행 기록은 삭제되지 않습니다.', () => {
        const settings = getUserSettings();
        const linkSupabaseId = settings.employerLink?.supabaseId;
        settings.employerLink = null;
        setUserSettings(settings);
        document.getElementById('employerInviteCode').value = '';
        document.getElementById('employerPhone').value = '';
        renderEmployedDriverLinkState();
        showToastMessage('소속 연동을 해제했습니다.');

        if (linkSupabaseId && typeof updateDriverLinkStatusOnSupabase === 'function') {
            updateDriverLinkStatusOnSupabase(linkSupabaseId, 'disconnected').catch(error => {
                console.error('소속 연동 해제 서버 반영 실패:', error);
            });
        }
    });
}

function showSubCarSettings(carNum) {
    previousPage = 'main';
    settingsReturnLogId = activeLogId;
    hideAllPages();
    loadSettings(); 
    document.getElementById('subCarSettingsPage').classList.remove('hidden');
    document.getElementById('subCarSettingsTitle').innerText = `${getShortCarNum(carNum)} 기사차량 운행 일지 설정`;
}

function switchCarLog(carNum) {
    activeLogId = carNum;
    document.body.classList.toggle('sub-car-log-active', carNum !== 'main');
    const bannerImg = document.getElementById('mainBannerImage');
    const bannerTxt = document.getElementById('mainBannerText');

    if (carNum === 'main') {
        if(bannerImg) bannerImg.style.display = 'inline-block';
        if(bannerTxt) bannerTxt.innerText = '운행 일지';
        if(bannerTxt) bannerTxt.classList.remove('sub-banner-text');
        workData = loadWorkDataForLog('main');
    } else {
        if(bannerImg) bannerImg.style.display = 'none';
        if(bannerTxt) bannerTxt.innerText = `${getShortCarNum(carNum)} 운행 일지`;
        if(bannerTxt) bannerTxt.classList.add('sub-banner-text');
        workData = loadWorkDataForLog(carNum);
    }
    
    normalizeLegacyData();
    renderSubCarMenu(); 
    buildCalendar();
    showMain(true);
    
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('sideMenuOverlay');
    menu.classList.remove('open');
    overlay.classList.remove('show');
}

// workData(운행 기록) 저장소 접근의 유일한 경계 지점. Supabase 연동 시 이 두 함수
// 내부만 localStorage → API 호출로 바꾸면 되고, 나머지 코드(운행 기록 계산, 화면
// 렌더링 등 workData를 메모리에서 읽고 쓰는 수백 곳)는 전혀 손댈 필요가 없다.
// logId는 'main' 또는 서브 차량 번호(car.number)다.
function loadWorkDataForLog(logId) {
    const key = logId === 'main' ? 'workData' : 'workData_' + logId;
    return JSON.parse(localStorage.getItem(key)) || {};
}

function saveWorkDataForLog(logId, data) {
    const key = logId === 'main' ? 'workData' : 'workData_' + logId;
    localStorage.setItem(key, JSON.stringify(data));
    if (typeof scheduleSupabaseWorkDataSync === 'function') scheduleSupabaseWorkDataSync(logId);
}

function saveDataToStorage() {
    writeWorkDataStoreForLog(activeLogId, workData);
}

// 미수금 등에서 지금 열려 있는 차량 로그(activeLogId)가 아닌 다른 차량의 운행 기록도
// 다뤄야 할 때 쓰는 헬퍼. logId는 'main' 또는 서브 차량 번호(car.number)다.
// activeLogId와 같은 로그를 읽을 때는 이미 메모리에 로드돼 수정 중인 전역 workData를
// 그대로 반환한다(참조를 공유하므로 그 자리에서 바로 수정해도 화면과 어긋나지 않는다).
// (다른 로그를 읽을 때는 readWorkDataStorage의 JSON 파싱 오류 방어를 그대로 쓰기 위해
// loadWorkDataForLog가 아니라 readWorkDataStorage를 계속 사용한다 — 동작을 바꾸지 않기 위함)
function readWorkDataStoreForLog(logId) {
    if (logId === activeLogId) return workData;
    return readWorkDataStorage(logId === 'main' ? 'workData' : 'workData_' + logId);
}

// 특정 로그의 운행 기록 저장소를 저장한다. saveDataToStorage()가 activeLogId에 대해 하던
// 일을 임의의 logId에 대해서도 똑같이 할 수 있도록 일반화한 버전이다. 실제 저장(키 계산
// + setItem)은 saveWorkDataForLog에 위임하고, 여기서는 그 위에 얹히는 부가 로직(고용
// 기사 연동 사본 동기화, 정규화 스토어 동기화 예약)만 처리한다.
function writeWorkDataStoreForLog(logId, data) {
    saveWorkDataForLog(logId, data);
    if (logId === 'main') {
        const settings = getUserSettings();
        const employerLink = settings.accountType === 'employed_driver' && settings.employerLink?.status === 'linked'
            ? settings.employerLink
            : null;
        const connectionKey = employerLink
            ? (employerLink.inviteCode || String(employerLink.ownerPhone || '').replace(/\D/g, ''))
            : '';
        if (connectionKey) localStorage.setItem(`linkedDriverWorkData_${connectionKey}`, JSON.stringify(data));
    }
    scheduleNormalizedEntitySync();
}

function normalizeLegacyData() {
    let dataChanged = false;

    for (let key in workData) {
        if (workData[key] === 'off') {
            workData[key] = {
                isOff: true,
                fixedCount: 0,
                palletCount: 0,
                maintItems: [],
                fuelItems: [],
                miscItems: [],
                callDetails: []
            };
            dataChanged = true;
        }

        if (!workData[key].callDetails) {
            workData[key].callDetails = [];
            dataChanged = true;
        }

        if (!workData[key].fuelItems) {
            workData[key].fuelItems = [];
            dataChanged = true;
        }

        if (!workData[key].miscItems) {
            workData[key].miscItems = [];
            dataChanged = true;
        }

    }

    if (dataChanged) {
        saveDataToStorage();
    }
}

// 거래처(client)에 이름과 무관한 고유 id를 부여하는 1회성 마이그레이션.
// id가 이미 있는 거래처는 건드리지 않고, id가 없는(과거에 저장된) 거래처만 새로 생성해 채운다.
function normalizeLegacyClientIds() {
    const settings = getUserSettings();
    if (!Array.isArray(settings.clients) || settings.clients.length === 0) return;

    let changed = false;
    settings.clients.forEach(client => {
        if (!client.id) {
            client.id = generateLocalId('client');
            changed = true;
        }
    });

    if (changed) {
        setUserSettings(settings);
    }
}

function getRecordTotalDistance(record) {
    const details = Array.isArray(record?.callDetails) ? record.callDetails : [];
    const hasDetailDistance = details.some(detail => String(detail?.distanceKm ?? '').trim() !== '');
    if (hasDetailDistance) {
        return details.reduce((total, detail) => total + (parseFloat(detail?.distanceKm) || 0), 0);
    }
    return parseFloat(record?.dailyDistance) || 0;
}

function populateYearMonthSelects(yearId, monthId) {
    const yearSelect = document.getElementById(yearId);
    const monthSelect = document.getElementById(monthId);
    const currentYear = new Date().getFullYear();

    yearSelect.innerHTML = '';
    monthSelect.innerHTML = '';

    for(let y = currentYear - 10; y <= currentYear + 10; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `${y}년`;
        yearSelect.appendChild(opt);
    }

    for(let m = 0; m < 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m + 1}월`;
        monthSelect.appendChild(opt);
    }
}

function initDateSelects() {
    populateYearMonthSelects('yearSelect', 'monthSelect');
}

function initMaintDateSelects() {
    populateYearMonthSelects('maintYearSelect', 'maintMonthSelect');
}

function initFuelDateSelects() {
    populateYearMonthSelects('fuelYearSelect', 'fuelMonthSelect');
}

function initMiscDateSelects() {
    populateYearMonthSelects('miscYearSelect', 'miscMonthSelect');
}

function changeYearMonth() {
    const y = parseInt(document.getElementById('yearSelect').value, 10);
    const m = parseInt(document.getElementById('monthSelect').value, 10);
    viewDate.setDate(1);
    viewDate.setFullYear(y);
    viewDate.setMonth(m);
    buildCalendar();
}

function initCalendarDOM() {
    const cellsContainer = document.getElementById('calendar-cells');
    cellsContainer.innerHTML = '';
    calendarCells.length = 0;

    for (let i = 0; i < 42; i++) {
        const cell = document.createElement('div');
        cell.classList.add('date-cell');
        
        const dateText = document.createElement('span');
        dateText.className = 'cell-date-text';
        cell.appendChild(dateText);

        cell.addEventListener('click', () => {
            if (cell.dataset.dateKey) {
                const month = parseInt(cell.dataset.month, 10);
                const day = parseInt(cell.dataset.day, 10);
                openModal(cell.dataset.dateKey, month, day);
            }
        });

        cellsContainer.appendChild(cell);
        calendarCells.push(cell);
    }
}

function formatCurrencyInput(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    if (value) {
        input.value = parseInt(value, 10).toLocaleString();
    } else {
        input.value = '';
    }
}

function parseCurrencyValue(str) {
    if (!str) return 0;
    return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0;
}

function formatPhoneNumber(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    if (value.length < 4) {
        input.value = value;
    } else if (value.length < 7) {
        input.value = `${value.slice(0, 3)}-${value.slice(3)}`;
    } else if (value.length < 11) {
        input.value = `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
    } else {
        input.value = `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7, 11)}`;
    }
}

async function downloadPDF() {
    const element = document.getElementById('reportContentToExport');
    document.body.classList.add('pdf-export-mode');
    
    if (!isDetailReportView) {
        buildReportPage(true);
    } else {
        viewDetailReport(true);
    }

    await new Promise(resolve => setTimeout(resolve, 50));

    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth() + 1;
    
    let fileName = `${currentYear}년_${currentMonth}월_운송비내역서.pdf`;
    if (isDetailReportView) {
        const titleText = document.getElementById('reportMonthTitle').textContent;
        const match = titleText.match(/\((.*?)\)/);
        const clientName = match ? match[1] : '전체';
        fileName = `${currentYear}년_${currentMonth}월_운송비내역서(세부)_${clientName}.pdf`;
    }
    
    const opt = {
        margin:       [12, 10, 12, 10],
        filename:     fileName, 
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(element).save();
    } finally {
        document.body.classList.remove('pdf-export-mode');
        if (!isDetailReportView) {
            buildReportPage(false); 
        } else {
            viewDetailReport(false);
        }
    }
}

async function prepareReportExport() {
    document.body.classList.add('pdf-export-mode');
    if (!isDetailReportView) buildReportPage(true);
    else viewDetailReport(true);
    await new Promise(resolve => setTimeout(resolve, 80));
    return document.getElementById('reportContentToExport');
}

function finishReportExport() {
    document.body.classList.remove('pdf-export-mode');
    if (!isDetailReportView) buildReportPage(false);
    else viewDetailReport(false);
}

function getReportFileBaseName() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth() + 1;
    if (!isDetailReportView) return `${year}년_${month}월_운송비내역서`;
    const title = document.getElementById('reportMonthTitle').textContent;
    const client = title.match(/\((.*?)\)/)?.[1] || '전체';
    return `${year}년_${month}월_운송비내역서(세부)_${client}`;
}

async function createReportCanvas() {
    const element = await prepareReportExport();
    return createReportCanvasFromElement(element);
}

async function createReportCanvasFromElement(element) {
    const worker = html2pdf().set({
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            scrollX: 0,
            scrollY: 0,
            backgroundColor: '#ffffff',
            windowWidth: element.scrollWidth,
            windowHeight: element.scrollHeight
        }
    }).from(element).toCanvas();
    return worker.get('canvas');
}

function createPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 이미지 생성 실패')), 'image/png');
    });
}

async function downloadReportImage() {
    let imageUrl = '';
    try {
        const canvas = await createReportCanvas();
        const blob = await createPngBlob(canvas);
        const link = document.createElement('a');
        link.download = `${getReportFileBaseName()}.png`;
        imageUrl = URL.createObjectURL(blob);
        link.href = imageUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        console.error('운송비 내역서 이미지 저장 실패:', error);
        showToastMessage('이미지 저장에 실패했습니다.');
    } finally {
        if (imageUrl) setTimeout(() => URL.revokeObjectURL(imageUrl), 1000);
        finishReportExport();
    }
}

function openReportShareModal() { document.getElementById('reportShareModal').classList.remove('hidden'); }
function closeReportShareModal() { document.getElementById('reportShareModal').classList.add('hidden'); }

function getDetailReportClientContact() {
    if (!isDetailReportView || currentDetailClientFilter === 'ALL') return null;
    const client = getUserSettings().clients?.find(item => item.companyName === currentDetailClientFilter);
    return client?.phone ? { name: client.companyName, phone: client.phone } : null;
}

async function createReportFile(type) {
    const element = await prepareReportExport();
    const baseName = getReportFileBaseName();
    if (type === 'image') {
        const canvas = await createReportCanvasFromElement(element);
        const blob = await createPngBlob(canvas);
        return new File([blob], `${baseName}.png`, { type: 'image/png' });
    }
    const opt = { margin:[12,10,12,10], image:{type:'jpeg',quality:.98}, html2canvas:{scale:2,useCORS:true,logging:false,scrollX:0,scrollY:0,backgroundColor:'#ffffff'}, jsPDF:{unit:'mm',format:'a4',orientation:'portrait'} };
    const blob = await html2pdf().set(opt).from(element).outputPdf('blob');
    return new File([blob], `${baseName}.pdf`, { type: 'application/pdf' });
}

function getDefaultReportShareMessagePattern() {
    return '안녕하세요, {거래처} 담당자님. 운송비 내역서입니다. 확인 부탁드립니다.';
}

function getReportShareMessagePattern() {
    try {
        return localStorage.getItem('reportShareMessagePattern')?.trim()
            || getDefaultReportShareMessagePattern();
    } catch (error) {
        return getDefaultReportShareMessagePattern();
    }
}

function fillReportShareMessagePattern(pattern, company = '거래처') {
    return String(pattern).replaceAll('{거래처}', company || '거래처');
}

function getReportShareCompanyName() {
    return isDetailReportView && currentDetailClientFilter !== 'ALL'
        ? currentDetailClientFilter
        : '거래처';
}

function getReportShareMessage() {
    return fillReportShareMessagePattern(
        getReportShareMessagePattern(),
        getReportShareCompanyName()
    );
}

async function shareReportToKakaoTalk(type = 'pdf') {
    closeReportShareModal();
    try {
        const formatLabel = type === 'image' ? '이미지' : 'PDF';
        showToastMessage(`카카오톡으로 보낼 ${formatLabel}를 준비하고 있습니다.`);
        const file = await createReportFile(type);
        if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
            showToastMessage('이 기기에서는 파일 공유를 지원하지 않습니다.');
            return;
        }
        await navigator.share({
            files: [file],
            title: '운송비 내역서',
            text: getReportShareMessage()
        });
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.error('카카오톡 내역서 공유 실패:', error);
            showToastMessage('카카오톡 파일 공유에 실패했습니다.');
        }
    } finally {
        finishReportExport();
    }
}

async function shareReportBySms(type = 'pdf') {
    const contact = getDetailReportClientContact();
    if (!contact) {
        showConfirmModal('특정 거래처의 상세내역을 조회하고, 거래처 연락처가 등록되어 있는지 확인해 주세요.', null);
        return;
    }

    closeReportShareModal();
    let fileUrl = '';
    try {
        const formatLabel = type === 'image' ? '이미지' : 'PDF';
        showToastMessage(`문자로 보낼 ${formatLabel}를 저장하고 있습니다.`);
        const file = await createReportFile(type);
        fileUrl = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.download = file.name;
        link.href = fileUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();

        const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
        const message = fillReportShareMessagePattern(getReportShareMessagePattern(), contact.name);
        window.location.href = `sms:${contact.phone}${separator}body=${encodeURIComponent(message)}`;
    } catch (error) {
        console.error('문자용 내역서 저장 실패:', error);
        showToastMessage('문자용 파일 저장에 실패했습니다.');
    } finally {
        if (fileUrl) setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
        finishReportExport();
    }
}

function hideAllPages() {
    closeNotificationPanel();
    document.body.classList.remove('account-flow-active');
    document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
    
    const workModal = document.getElementById('workModal');
    if(workModal) workModal.classList.add('hidden');
    
    document.getElementById('sideMenu').classList.remove('open');
    document.getElementById('sideMenuOverlay').classList.remove('show');
    
    document.getElementById('pdfDownloadBtn').style.display = 'none';
    
    const pdfGroup = document.getElementById('pdfDropdownGroup');
    if (pdfGroup) pdfGroup.style.display = 'none';
    const pdfMenu = document.getElementById('pdfMenuDropdown');
    if (pdfMenu) pdfMenu.classList.remove('show');

    const backBtn = document.getElementById('subCarBackBtn');
    if (backBtn) backBtn.style.display = 'none';

    const notificationBtn = document.getElementById('notificationBtn');
    if (notificationBtn) notificationBtn.style.display = 'none';
}

let mobileBackIntegrationReady = false;
let mobileNativeExitRequested = false;

function handleCurrentAppBack() {
    const sideMenu = document.getElementById('sideMenu');
    if (sideMenu?.classList.contains('open')) {
        toggleMenu();
        return true;
    }

    const notificationPanel = document.getElementById('notificationPanel');
    if (notificationPanel?.classList.contains('open')) {
        closeNotificationPanel();
        return true;
    }

    const visibleModals = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
    const visibleModal = visibleModals[visibleModals.length - 1];
    if (visibleModal) {
        const modalBackButton = visibleModal.querySelector(
            'button[title="뒤로가기"], button[aria-label="뒤로가기"], .modal-btn.cancel, button.cancel'
        );
        if (modalBackButton) modalBackButton.click();
        else visibleModal.classList.add('hidden');
        return true;
    }

    const visiblePage = document.querySelector('.page:not(.hidden)');
    const pageBackButton = visiblePage?.querySelector(
        'button[title="뒤로가기"]:not(.hidden), button[aria-label="뒤로가기"]:not(.hidden)'
    );
    if (pageBackButton) {
        pageBackButton.click();
        return true;
    }

    if (activeLogId !== 'main' && !document.getElementById('mainPage')?.classList.contains('hidden')) {
        switchCarLog('main');
        return true;
    }

    return false;
}

function armMobileBackGuard() {
    try {
        history.pushState({ ...(history.state || {}), appBackGuard: true }, document.title);
    } catch (error) {
        console.warn('모바일 뒤로가기 상태 저장 실패:', error);
    }
}

function setupMobileBackIntegration() {
    if (mobileBackIntegrationReady || !window.history?.pushState) return;
    mobileBackIntegrationReady = true;

    try {
        history.replaceState({ ...(history.state || {}), appBackRoot: true, appBackGuard: false }, document.title);
        armMobileBackGuard();
    } catch (error) {
        console.warn('모바일 뒤로가기 초기화 실패:', error);
        return;
    }

    window.addEventListener('popstate', () => {
        if (mobileNativeExitRequested) {
            mobileNativeExitRequested = false;
            return;
        }

        if (handleCurrentAppBack()) {
            armMobileBackGuard();
            return;
        }

        mobileNativeExitRequested = true;
        history.back();
    });
}

function setActiveNav(pageId) {
    document.querySelectorAll('.bottom-nav-bar .nav-item').forEach(item => item.classList.remove('active'));
    const navItems = document.querySelectorAll('.bottom-nav-bar .nav-item');
    if (navItems.length >= 3) {
        if (pageId === 'main') {
            navItems[0].classList.add('active');
        } else if (pageId === 'workModal') {
            navItems[1].classList.add('active');
        } else if (pageId === 'revenue') {
            navItems[2].classList.add('active');
        } else if (pageId === 'personal' && navItems[3]) {
            navItems[3].classList.add('active');
        }
    }
}

function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('sideMenuOverlay');
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        overlay.classList.remove('show');
    } else {
        menu.classList.add('open');
        overlay.classList.add('show');
        renderSubCarMenu(); 
    }
    
    const pdfMenu = document.getElementById('pdfMenuDropdown');
    if (pdfMenu) pdfMenu.classList.remove('show');
}

function togglePdfMenu() {
    const menu = document.getElementById('pdfMenuDropdown');
    if (menu) {
        menu.classList.toggle('show');
    }
}

function showMain(skipRedirect = false) {
    if (!skipRedirect && activeLogId !== 'main') {
        switchCarLog('main');
        return;
    }

    hideAllPages();
    document.getElementById('mainPage').classList.remove('hidden');
    // 차량관리 등 다른 화면에서 무언가 저장하고 홈으로 돌아왔을 때, 홈 화면(mainPage)은
    // hideAllPages()로 숨겨져만 있었을 뿐 DOM에 그대로 남아있던 예전 렌더링을 다시 보여주는
    // 것뿐이라 그 사이의 변경(수수료 설정 등 달력 수치에 영향을 주는 값)이 반영 안 된 "이전
    // 기록"이 잠깐 보였다가, 다른 계기로 buildCalendar()가 다시 불릴 때에야 최신 값으로
    // 바뀌는 것처럼 보이는 문제가 있었다(실제로 보고됨). 여기서 항상 다시 그려서 이 화면이
    // 뜰 때는 항상 최신 상태이게 한다.
    buildCalendar();

    const notificationBtn = document.getElementById('notificationBtn');
    if (notificationBtn) notificationBtn.style.display = 'flex';
    
    const backBtn = document.getElementById('subCarBackBtn');
    if (backBtn && activeLogId !== 'main') {
        backBtn.style.display = 'flex'; 
    }

    document.getElementById('menuReportBtn').style.display = 'flex';
    setActiveNav('main');
    checkBackupReminder();
}

let utilityReturnPage = 'main';
let personalInfoReturnPage = 'myPage';
let utilityReturnLogId = 'main';
let personalInfoReturnLogId = 'main';
let myPageReturnLogId = 'main';
let settingsReturnLogId = 'main';

function getValidReturnLogId(logId) {
    if (!logId || logId === 'main') return 'main';
    const cars = getUserSettings().cars || [];
    return cars.some(car => car.type === 'sub' && car.number === logId && car.logEnabled) ? logId : 'main';
}

function returnToLogHome(logId = 'main') {
    const targetLogId = getValidReturnLogId(logId);
    if (activeLogId !== targetLogId) {
        switchCarLog(targetLogId);
    } else {
        showMain(true);
    }
}

function setUtilityReturnPage(returnPage = 'main') {
    utilityReturnPage = returnPage === 'myPage' ? 'myPage' : 'main';
    utilityReturnLogId = activeLogId;
}

function goBackFromUtilityPage() {
    const returnPage = utilityReturnPage;
    const returnLogId = utilityReturnLogId;
    utilityReturnPage = 'main';
    if (returnPage === 'myPage') {
        showMyPage(true);
    } else {
        returnToLogHome(returnLogId);
    }
}

function showMyPage(preserveReturnLog = false) {
    if (!preserveReturnLog) myPageReturnLogId = activeLogId;
    utilityReturnPage = 'main';
    const settings = getUserSettings();
    const isEmployedDriver = settings.accountType === 'employed_driver';

    // 개인정보 카드: [차주/소속 기사] 뱃지 + 이름
    const roleBadge = document.getElementById('myPageRoleBadge');
    const userNameText = document.getElementById('myPageUserNameText');
    if (roleBadge) roleBadge.textContent = isEmployedDriver ? '소속 기사' : '차주';
    if (userNameText) userNameText.textContent = settings.userName || (isEmployedDriver ? '기사' : '대표자');

    renderBackupStatus();

    hideAllPages();
    document.getElementById('myPage').classList.remove('hidden');
    setActiveNav('personal');
}

function goBackFromMyPage() {
    returnToLogHome(myPageReturnLogId);
}

function showBillingSettingsPage() {
    const settings = getUserSettings();
    const modeSelect = document.getElementById('defaultDriverSettlementMode');
    const basisSelect = document.getElementById('driverInvoiceBasis');
    modeSelect.value = settings.defaultDriverSettlementMode || 'company';
    basisSelect.value = settings.driverInvoiceBasis || 'net';
    modeSelect.parentElement?._dropdownSync?.();
    basisSelect.parentElement?._dropdownSync?.();
    updateBillingSettingsGuide();
    hideAllPages();
    document.getElementById('billingSettingsPage').classList.remove('hidden');
    setActiveNav('personal');
}

function saveBillingSettings() {
    queueBackgroundSave('billing-settings', commitBillingSettings);
}

function commitBillingSettings() {
    const settings = getUserSettings();
    settings.defaultDriverSettlementMode = document.getElementById('defaultDriverSettlementMode').value || 'company';
    settings.driverInvoiceBasis = document.getElementById('driverInvoiceBasis').value || 'net';
    setUserSettings(settings);
    showToastMessage('정산·계산서 기본 설정을 저장했습니다.');
}

function updateBillingSettingsGuide() {
    const mode = document.getElementById('defaultDriverSettlementMode')?.value || 'company';
    const basis = document.getElementById('driverInvoiceBasis')?.value || 'net';
    const meta = getDriverSettlementModeMeta(mode);
    const basisText = basis === 'gross' ? '기사 매입 계산서는 공제 전 운송료를 기준으로 준비합니다.' : '기사 매입 계산서는 수수료·산재보험료 공제 후 지급액을 기준으로 준비합니다.';
    const guide = document.getElementById('billingSettingsModeGuide');
    if (guide) guide.innerHTML = `<strong>${meta.label}</strong><br>${meta.description}<br>${basisText}`;
}

function updateDriverSettlementModeGuide() {
    const select = document.getElementById('newCarSettlementMode');
    const guide = document.getElementById('newCarSettlementModeGuide');
    if (!select || !guide) return;
    const settings = getUserSettings();
    const effectiveMode = select.value === 'default' ? (settings.defaultDriverSettlementMode || 'company') : select.value;
    const meta = getDriverSettlementModeMeta(effectiveMode);
    guide.textContent = select.value === 'default' ? `기본값 · ${meta.label} — ${meta.description}` : meta.description;
}

function showNoticePage() {
    hideAllPages();
    document.getElementById('noticePage').classList.remove('hidden');
    setActiveNav('personal');
}

function showMessageSettingsPage() {
    const messagePatterns = getMessageTemplatePatterns();
    const unpaidInput = document.getElementById('unpaidMessageTemplateInput');
    const paymentRequestInput = document.getElementById('paymentRequestMessageTemplateInput');
    const tripCompleteInput = document.getElementById('tripCompleteMessageTemplateInput');
    const reportInput = document.getElementById('reportShareMessageInput');

    if (unpaidInput) unpaidInput.value = messagePatterns[0];
    if (paymentRequestInput) paymentRequestInput.value = messagePatterns[1];
    if (tripCompleteInput) tripCompleteInput.value = messagePatterns[2];
    if (reportInput) reportInput.value = getReportShareMessagePattern();

    hideAllPages();
    document.getElementById('messageSettingsPage').classList.remove('hidden');
    setActiveNav('personal');
}

function saveMessageSettings() {
    const unpaidMessage = document.getElementById('unpaidMessageTemplateInput')?.value.trim() || '';
    const paymentRequestMessage = document.getElementById('paymentRequestMessageTemplateInput')?.value.trim() || '';
    const tripCompleteMessage = document.getElementById('tripCompleteMessageTemplateInput')?.value.trim() || '';
    const reportMessage = document.getElementById('reportShareMessageInput')?.value.trim() || '';

    if (!unpaidMessage || !paymentRequestMessage || !tripCompleteMessage || !reportMessage) {
        showToastMessage('모든 문자 문구를 입력해 주세요.');
        return;
    }

    const messagePatterns = [unpaidMessage, paymentRequestMessage, tripCompleteMessage];

    try {
        localStorage.setItem('messageTemplateCustomBodies', JSON.stringify(messagePatterns));
        localStorage.setItem('reportShareMessagePattern', reportMessage);
        showToastMessage('문자 문구를 저장했습니다.');
    } catch (error) {
        console.error('문자 문구 저장 실패:', error);
        showToastMessage('문자 문구를 저장하지 못했습니다.');
    }
}

function resetMessageSettings() {
    const defaultPatterns = getDefaultMessageTemplatePatterns();

    try {
        localStorage.removeItem('messageTemplateCustomBodies');
        localStorage.removeItem('reportShareMessagePattern');
    } catch (error) {
        console.error('기본 문자 문구 복원 실패:', error);
        showToastMessage('기본 문구를 복원하지 못했습니다.');
        return;
    }

    const unpaidInput = document.getElementById('unpaidMessageTemplateInput');
    const paymentRequestInput = document.getElementById('paymentRequestMessageTemplateInput');
    const tripCompleteInput = document.getElementById('tripCompleteMessageTemplateInput');
    const reportInput = document.getElementById('reportShareMessageInput');
    if (unpaidInput) unpaidInput.value = defaultPatterns[0];
    if (paymentRequestInput) paymentRequestInput.value = defaultPatterns[1];
    if (tripCompleteInput) tripCompleteInput.value = defaultPatterns[2];
    if (reportInput) reportInput.value = getDefaultReportShareMessagePattern();
    showToastMessage('기본 문구로 복원했습니다.');
}

function showPersonalInfo(fromPage) {
    if (!fromPage) {
        const taxPage = document.getElementById('taxInvoicePage');
        fromPage = taxPage && !taxPage.classList.contains('hidden') ? 'tax' : 'myPage';
    }
    personalInfoReturnPage = fromPage;
    personalInfoReturnLogId = activeLogId;
    loadSettings();
    updateAccountRoleUI();
    hideAllPages();
    document.getElementById('personalInfoPage').classList.remove('hidden');
    setActiveNav('personal');

    // 소속 기사이고 이미 연동돼 있으면, 연결된 차량의 사업자정보/차량정보가 그 사이 바뀌었을
    // 수 있으니 화면을 열 때마다 최신값으로 다시 채운다(화면을 막지 않게 백그라운드로).
    // 로컬 캐시(employerLink.vehicleId/ownerId)는 차주가 이 기사를 다른 차량으로 재할당했을
    // 때 바로 갱신되지 않으므로, driver_links를 supabaseId 기준으로 서버에서 다시 읽어
    // 지금 실제로 배정된 owner_id/vehicle_id를 확보한 뒤에만 자동반영을 실행한다(요구사항:
    // 차량 재할당 시에도 항상 서버 기준 최신 차량의 사업자정보를 써야 함).
    const settings = getUserSettings();
    const link = settings.employerLink;
    if (link?.status === 'linked' && typeof applyEmployerAutoFilledInfo === 'function') {
        (async () => {
            try {
                let ownerId = link.ownerId || null;
                let vehicleId = link.vehicleId || null;
                if (typeof getSupabaseClient === 'function' && link.supabaseId) {
                    const client = await getSupabaseClient();
                    const { data } = await client.from('driver_links').select('owner_id, vehicle_id').eq('id', link.supabaseId).maybeSingle();
                    if (data?.owner_id) { ownerId = data.owner_id; vehicleId = data.vehicle_id; }
                }
                if (ownerId) await applyEmployerAutoFilledInfo(ownerId, vehicleId);
            } catch (error) {
                console.error('연동된 차주/차량 정보 재조회 실패(로컬 캐시로 계속 진행):', error);
            }
        })();
    }
}

function goBackFromPersonalInfo() {
    if (personalInfoReturnPage === 'tax') {
        showTaxInvoices(utilityReturnPage);
    } else if (personalInfoReturnPage === 'myPage') {
        showMyPage(true);
    } else {
        returnToLogHome(personalInfoReturnLogId);
    }
}

function showCustomerCenter(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('customerCenterPage').classList.remove('hidden');
    // 이전 방문에서 "1:1 문의" 탭을 보고 있었더라도, 고객센터에 다시 들어올 때는 항상
    // 첫 번째 탭(FAQ)이 기본으로 보이게 초기화한다.
    const faqTabBtn = document.querySelector('.support-tab:first-child');
    if (faqTabBtn) openSupportTab('faq', faqTabBtn);
}

function openSupportTab(tabName, button) {
    document.querySelectorAll('.support-panel').forEach(panel => panel.classList.add('hidden'));
    document.querySelectorAll('.support-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`support-${tabName}`).classList.remove('hidden');
    button.classList.add('active');
    if (tabName === 'myInquiries') renderMyInquiries();
}

function toggleSupportItem(item) {
    item.classList.toggle('open');
    const icon = item.querySelector('i');
    if (icon) icon.textContent = item.classList.contains('open') ? '−' : '+';
}

function getSupportInquiries() {
    try {
        const inquiries = JSON.parse(localStorage.getItem('supportInquiries') || '[]');
        return Array.isArray(inquiries) ? inquiries : [];
    } catch (error) {
        return [];
    }
}

function submitSupportInquiry(event) {
    event.preventDefault();
    const inquiry = {
        id: generateLocalId('inquiry'),
        type: document.getElementById('inquiryType').value,
        title: document.getElementById('inquiryTitle').value.trim(),
        content: document.getElementById('inquiryContent').value.trim(),
        status: 'open',
        answer: '',
        answeredAt: '',
        createdAt: new Date().toISOString()
    };
    const inquiries = getSupportInquiries();
    inquiries.unshift(inquiry);
    localStorage.setItem('supportInquiries', JSON.stringify(inquiries));
    // 예전엔 이 기기 안에만 저장되고 실제로는 아무 데도 전달되지 않았다(§전수 점검에서 발견).
    // 이제 Supabase로도 반영해서 실제로 확인 가능하게 한다.
    if (typeof scheduleSupabaseInquirySync === 'function') scheduleSupabaseInquirySync(inquiry.id);
    event.target.reset();
    showToastMessage('문의가 접수되었습니다.');
    renderMyInquiries();
}

// "나의 문의·건의 확인" 탭 — 본인이 접수한 문의를 최신순으로 보여준다. 아직 사장님이 답변
// 기능을 안 만드셨어도(=support_inquiries.answer가 비어있어도) 목록/상태는 바로 쓸 수 있게
// "답변 대기" 상태로 표시해 둔다.
function renderMyInquiries() {
    const container = document.getElementById('myInquiriesList');
    if (!container) return;
    const inquiries = getSupportInquiries();

    if (!inquiries.length) {
        container.innerHTML = '<div class="support-panel-empty">아직 접수한 문의·건의가 없습니다.</div>';
        return;
    }

    container.innerHTML = inquiries.map(inquiry => {
        const answered = !!inquiry.answer;
        const dateText = inquiry.createdAt ? new Date(inquiry.createdAt).toLocaleDateString('ko-KR') : '';
        return `
            <div class="my-inquiry-card">
                <div class="my-inquiry-head">
                    <span class="my-inquiry-type">${escapeDetailText(inquiry.type || '문의')}</span>
                    <span class="my-inquiry-status ${answered ? 'answered' : 'pending'}">${answered ? '답변 완료' : '답변 대기'}</span>
                </div>
                <strong class="my-inquiry-title">${escapeDetailText(inquiry.title || '')}</strong>
                <p class="my-inquiry-content">${escapeDetailText(inquiry.content || '')}</p>
                <div class="my-inquiry-date">${dateText}</div>
                ${answered ? `<div class="my-inquiry-answer"><span class="my-inquiry-answer-label">운영자 답변</span><p>${escapeDetailText(inquiry.answer)}</p></div>` : ''}
            </div>
        `;
    }).join('');
}

// 회원탈퇴 — 실제로 Supabase 계정과 그 계정에 연결된 모든 데이터(vehicles/clients/
// daily_logs/... 전부, DB의 cascade 설정으로 자동 삭제)를 지우는 되돌릴 수 없는 작업이다.
// 그래서 확인을 두 단계로 나눈다: 1단계 경고 → 2단계 최종 확인 → 그 다음에야 실제 삭제.
// showConfirmModal()의 executeConfirm()은 콜백 실행 직후 곧바로 closeConfirmModal()을
// 호출하므로, 콜백 안에서 바로 showConfirmModal()을 또 열면 그 트레일링 close가 방금 연
// 두 번째 모달까지 닫아버린다. 그래서 두 번째 모달은 setTimeout으로 다음 태스크로 미뤄서 연다.
function requestWithdrawal() {
    showConfirmModal(
        '정말 탈퇴하시겠습니까?\n모든 운행 기록, 거래처, 정산 데이터가 영구적으로 삭제되며 복구할 수 없습니다.',
        () => {
            setTimeout(() => {
                showConfirmModal(
                    '이 작업은 취소할 수 없습니다.\n한 번 더 확인해 주세요 — 정말로 계정과 모든 데이터를 영구 삭제할까요?',
                    executeAccountWithdrawal,
                    { title: '마지막 확인', confirmLabel: '영구 삭제', cancelLabel: '취소', tone: 'danger' }
                );
            }, 0);
        },
        { title: '회원 탈퇴', confirmLabel: '탈퇴하기', cancelLabel: '취소', tone: 'danger' }
    );
}

async function executeAccountWithdrawal() {
    if (typeof getSupabaseClient !== 'function') {
        showToastMessage('탈퇴 처리에 필요한 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { duration: 5000 });
        return;
    }

    try {
        const client = await getSupabaseClient();
        const { error } = await client.rpc('delete_own_account');
        if (error) throw error;
    } catch (error) {
        // 서버 삭제가 실패했다면 로컬 데이터는 절대 건드리지 않는다 — 서버는 안 지워졌는데
        // 로컬만 지우면 사용자가 자기 데이터를 그냥 잃어버리는 최악의 상황이 된다.
        console.error('회원 탈퇴 실패:', error);
        showToastMessage(getSaveErrorMessage(error) || '탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', { duration: 5000 });
        return;
    }

    // 서버 삭제 성공을 확인한 뒤에만 로컬을 정리한다.
    try {
        if (typeof supabaseSignOutSafely === 'function') await supabaseSignOutSafely();
    } catch (error) {
        console.error('탈퇴 후 로그아웃 처리 실패(로컬 정리는 계속 진행):', error);
    }
    localStorage.clear();
    showToastMessage('탈퇴가 완료되었습니다.', { duration: 1500 });
    // 메모리에 남아있는 이전 계정의 상태(workData 등)까지 완전히 비우고 첫 화면(계정 유형
    // 선택)부터 다시 시작하도록, 토스트를 보여줄 시간만 두고 전체 새로고침한다.
    setTimeout(() => location.reload(), 1200);
}

function showCarManagement(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('carManagementPage').classList.remove('hidden');
    loadCarList();
}

function showClientManagement(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('clientManagementPage').classList.remove('hidden');
    renderClientList(); 
}

let editingClientIndex = -1;
let clientPressTimer = null;
let clientDragState = null;

function startClientDrag(card, clientIndex, pointerY) {
    const container = document.getElementById('clientListContainer');
    if (!card || !container || clientDragState?.active) return;

    clientDragState = { active: true, card, clientIndex, pinned: card.dataset.pinned === 'true' };
    card.classList.add('client-dragging');
    container.classList.add('client-drag-active');
    card.setAttribute('aria-grabbed', 'true');
    navigator.vibrate?.(30);
    updateClientDragPosition(pointerY);
}

function updateClientDragPosition(pointerY) {
    if (!clientDragState?.active) return;

    const { card, pinned } = clientDragState;
    const candidate = document.elementFromPoint(window.innerWidth / 2, pointerY)?.closest('.client-list-card');
    if (candidate && candidate !== card && candidate.dataset.pinned === String(pinned)) {
        const cards = [...document.querySelectorAll('#clientListContainer .client-list-card')];
        const previousPositions = new Map(cards.map(item => [item, item.getBoundingClientRect()]));
        const rect = candidate.getBoundingClientRect();
        candidate.parentNode.insertBefore(card, pointerY > rect.top + (rect.height / 2) ? candidate.nextSibling : candidate);
        animateClientCardReorder(cards, previousPositions, card);
    }

    const edge = 72;
    if (pointerY < edge) window.scrollBy({ top: -10, behavior: 'auto' });
    else if (pointerY > window.innerHeight - edge) window.scrollBy({ top: 10, behavior: 'auto' });
}

function animateClientCardReorder(cards, previousPositions, draggedCard) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    cards.forEach(item => {
        const previous = previousPositions.get(item);
        const current = item.getBoundingClientRect();
        const offsetY = previous?.top - current.top;
        if (!offsetY) return;

        item.getAnimations().forEach(animation => animation.cancel());

        if (item === draggedCard) {
            item.animate(
                [
                    { transform: `translate3d(0, ${offsetY}px, 0) scale(1.032)` },
                    { transform: 'translate3d(0, 0, 0) scale(1.018)', offset: .72 },
                    { transform: 'translate3d(0, 0, 0) scale(1.022)', offset: .86 },
                    { transform: 'translate3d(0, 0, 0) scale(1.018)' }
                ],
                { duration: 380, easing: 'cubic-bezier(.2, .9, .25, 1)', fill: 'both' }
            );
            return;
        }

        item.animate(
            [
                { transform: `translate3d(0, ${offsetY}px, 0) scale(.995)` },
                { transform: 'translate3d(0, 0, 0) scale(1)', offset: .76 },
                { transform: 'translate3d(0, -1.5px, 0) scale(1.002)', offset: .88 },
                { transform: 'translate3d(0, 0, 0) scale(1)' }
            ],
            { duration: 360, easing: 'cubic-bezier(.2, .9, .25, 1)' }
        );
    });
}

function finishClientDrag() {
    window.clearTimeout(clientPressTimer);
    clientPressTimer = null;
    if (!clientDragState?.active) {
        clientDragState = null;
        return;
    }

    const { card } = clientDragState;
    const settings = getUserSettings();
    const originalClients = settings.clients || [];
    const orderedIndexes = [...document.querySelectorAll('#clientListContainer .client-list-card')]
        .map(item => Number(item.dataset.clientIndex));

    if (orderedIndexes.length === originalClients.length) {
        settings.clients = orderedIndexes.map(index => originalClients[index]);
        setUserSettings(settings);
    }

    card.classList.remove('client-dragging');
    card.setAttribute('aria-grabbed', 'false');
    document.getElementById('clientListContainer')?.classList.remove('client-drag-active');
    clientDragState = null;
    renderClientList();
}

function bindClientDragEvents(card, clientIndex) {
    let startX = 0;
    let startY = 0;

    card.addEventListener('touchstart', event => {
        if (event.target.closest('button')) return;
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        window.clearTimeout(clientPressTimer);
        clientPressTimer = window.setTimeout(() => startClientDrag(card, clientIndex, startY), 520);
    }, { passive: true });

    card.addEventListener('touchmove', event => {
        const touch = event.touches[0];
        if (clientDragState?.active && clientDragState.card === card) {
            event.preventDefault();
            updateClientDragPosition(touch.clientY);
        } else if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 8) {
            window.clearTimeout(clientPressTimer);
            clientPressTimer = null;
        }
    }, { passive: false });

    card.addEventListener('touchend', event => {
        if (clientDragState?.active && clientDragState.card === card) event.preventDefault();
        finishClientDrag();
    }, { passive: false });
    card.addEventListener('touchcancel', finishClientDrag);

    card.addEventListener('mousedown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        startY = event.clientY;
        window.clearTimeout(clientPressTimer);
        clientPressTimer = window.setTimeout(() => startClientDrag(card, clientIndex, startY), 520);

        const onMove = moveEvent => {
            if (clientDragState?.active && clientDragState.card === card) {
                moveEvent.preventDefault();
                updateClientDragPosition(moveEvent.clientY);
            } else if (Math.abs(moveEvent.clientY - startY) > 8) {
                window.clearTimeout(clientPressTimer);
            }
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            finishClientDrag();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function renderClientList() {
    const settings = getUserSettings();
    let clients = settings.clients || [];
    const container = document.getElementById('clientListContainer');
    container.innerHTML = '';

    // 항상 '고정 거래처'가 최상단으로 오도록 정렬 (단, 동일 그룹 내의 순서는 유지)
    clients.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return 0;
    });
    // 정렬된 상태를 저장소에 갱신하여 렌더링 순서와 실제 데이터 인덱스를 동기화
    settings.clients = clients; 
    setUserSettings(settings);

    if (clients.length === 0) {
        container.innerHTML = '<div class="empty-state">등록된 거래처가 없습니다.</div>';
        return;
    }

    clients.forEach((client, idx) => {
        let badges = '';
        // 즐겨찾기 표시 뱃지(예전 "고정 거래처" 스위치 — 이름/모양만 바뀜, 목록 맨 위 정렬은 그대로)
        if (client.isPinned) {
            badges += `<span class="management-badge pinned">★ 즐겨찾기</span>`;
        }
        if (client.commEnabled) {
            const badgeText = client.commType === 'direct' ? `${client.commValue}원` : `${client.commValue}%`;
            badges += `<span class="management-badge commission">수수료 ${escapeDetailText(badgeText)}</span>`;
        }
        // 고정노선과 연동된 거래처(계정 전체에서 1곳뿐)를 목록에서도 바로 알아볼 수 있게 표시한다.
        if (client.fixedRouteLinked) {
            badges += '<span class="management-badge tax-invoice">고정노선 연동</span>';
        }
        if (client.palletOn) {
            badges += '<span class="management-badge tax-invoice">파렛트</span>';
        }

        const div = document.createElement('div');
        div.className = 'car-card management-list-card client-list-card'; 
        div.dataset.clientIndex = String(idx);
        div.dataset.pinned = String(!!client.isPinned);
        div.setAttribute('aria-grabbed', 'false');
        bindClientDragEvents(div, idx);

        div.innerHTML = `
            <div class="management-card-inner">
                <div class="management-card-copy">
                    <div class="client-card-title"><strong>${escapeDetailText(client.companyName)}</strong>${client.managerName ? `<span>${escapeDetailText(client.managerName)} 담당</span>` : ''}</div>
                    <div class="client-card-badges">${badges}</div>
                    <div class="car-sub-text"><span>사업자 ${escapeDetailText(client.bizNumber || '-')}</span><span>연락처 ${escapeDetailText(client.phone || '-')}</span></div>
                    <div class="car-sub-text">결제주기: ${escapeDetailText(getPaymentTermLabel(client.paymentTerm || 'next_month_end', client.paymentTermValue || ''))}</div>
                </div>
                <div class="car-action-btns">
                    <button type="button" class="action-icon-btn" onclick="openClientModal(${idx}); event.stopPropagation();" title="수정">${editDetailSvg()}</button>
                    <button type="button" class="action-icon-btn del" onclick="deleteClient(${idx}); event.stopPropagation();" title="삭제">${deleteDetailSvg()}</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

// 예전엔 "고정 거래처" 스위치였는데, 실제로는 "이 거래처를 목록 맨 위에 즐겨찾기"하는
// 기능이라(고정노선의 "고정 거래처"와는 완전히 다른 개념) 별 아이콘으로 이름·모양만
// 바꿨다. 값 자체는 그대로 clientPinnedToggle(checkbox)에 저장된다 — 저장/불러오기 코드는
// 안 건드리고 화면만 바뀐 것. 예전처럼 수수료 적용을 강제로 껐다 켰다 하지 않는다(수수료는
// 이제 완전히 독립적으로 켤 수 있다).
function toggleClientFavoriteStar() {
    const checkbox = document.getElementById('clientPinnedToggle');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    updateClientFavoriteStarUI();
}

function updateClientFavoriteStarUI() {
    const checkbox = document.getElementById('clientPinnedToggle');
    const star = document.getElementById('clientFavoriteStar');
    if (!checkbox || !star) return;
    star.textContent = checkbox.checked ? '★' : '☆';
    star.classList.toggle('active', checkbox.checked);
    star.setAttribute('aria-pressed', checkbox.checked ? 'true' : 'false');
}

function toggleClientComm() {
    const isChecked = document.getElementById('clientCommToggle').checked;
    setSettingsGroupExpanded(document.getElementById('clientCommSection'), isChecked);
}

// 고정노선과 연동 — 계정 전체에서 거래처 1곳만 켤 수 있다. 여기서 다른 거래처의 값까지
// 건드리진 않는다(그건 저장 시점에 saveClient가 처리) — 이 화면(지금 편집 중인 거래처) 안의
// 하위 입력칸(단가 + 파렛트 회수) 노출 여부만 담당한다. 파렛트 회수는 고정노선과 연동일
// 때만 의미가 있는 자식 항목이라, 부모가 꺼지면 파렛트도 같이 꺼진다.
function toggleClientFixedRoute() {
    const isChecked = document.getElementById('clientFixedRouteToggle').checked;
    setSettingsGroupExpanded(document.getElementById('clientFixedRouteSubSettings'), isChecked);
    if (!isChecked) {
        document.getElementById('clientPalletToggle').checked = false;
        toggleClientPallet();
    }
}

function toggleClientPallet() {
    const isChecked = document.getElementById('clientPalletToggle').checked;
    setSettingsGroupExpanded(document.getElementById('clientPalletSubSettings'), isChecked);
}

function formatCommValue(input) {
    let val = input.value.replace(/[^0-9.]/g, '');
    if (parseFloat(val) > 100) val = '100';
    input.value = val;
}

function setClientCommType(type) {
    const typeEl = document.getElementById('clientCommType');
    if (typeEl) typeEl.value = type;

    const btnPercent = document.getElementById('btnCommTypePercent');
    const btnDirect = document.getElementById('btnCommTypeDirect');
    const commInput = document.getElementById('clientCommValue');

    // commLabel(별도 라벨 줄)은 UI를 줄이면서 없앴다 — 지금 뭘 입력하는 건지는 input의
    // placeholder 하나로 충분히 전달된다.
    if (!btnPercent || !btnDirect || !commInput) return;

    if (type === 'percent') {
        btnPercent.classList.add('active-work');
        btnDirect.classList.remove('active-work');
        commInput.placeholder = '비율(%) 입력';
        let val = commInput.value.replace(/[^0-9.]/g, '');
        if (parseFloat(val) > 100) val = '100';
        commInput.value = val;
    } else {
        btnDirect.classList.add('active-work');
        btnPercent.classList.remove('active-work');
        commInput.placeholder = '금액(원) 입력';
        formatCurrencyInput(commInput);
    }
}

function formatClientCommValue(input) {
    const typeEl = document.getElementById('clientCommType');
    const type = typeEl ? typeEl.value : 'percent';
    if (type === 'percent') {
        let val = input.value.replace(/[^0-9.]/g, '');
        if (parseFloat(val) > 100) val = '100';
        input.value = val;
    } else {
        formatCurrencyInput(input);
    }
}

function closeClientModal() {
    document.getElementById('clientModal').classList.add('hidden');
}

function cancelClientModal() {
    clientModalOpenedFromCallDetail = false;
    closeClientModal();
}

/* 단순 선택형 입력을 앱 내부 드롭다운으로 표시한다. 원본 select의 값과 이벤트는 유지한다. */
const APP_OVERLAY_GAP = 7;
const APP_OVERLAY_EDGE = 8;

function positionAnchoredOverlay(anchor, overlay) {
    if (!anchor || !overlay || overlay.hidden) return;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width || document.documentElement.clientWidth;
    const availableRight = viewportWidth - APP_OVERLAY_EDGE;
    const left = rect.right > availableRight
        ? Math.max(APP_OVERLAY_EDGE, availableRight - rect.width)
        : rect.left;

    overlay.style.left = `${left}px`;
    overlay.style.top = `${rect.bottom + APP_OVERLAY_GAP}px`;
    overlay.style.bottom = 'auto';
    overlay.style.width = `${rect.width}px`;
}

function refreshOpenAnchoredOverlays() {
    document.querySelectorAll('.app-dropdown.open').forEach(wrapper => {
        positionAnchoredOverlay(wrapper.querySelector('.app-dropdown-trigger'), wrapper._dropdownMenu);
    });
    document.querySelectorAll('.app-temporal.open').forEach(wrapper => wrapper._temporalPosition?.());
    document.querySelectorAll('input[data-app-autocomplete][aria-expanded="true"]').forEach(input => input._autocompletePosition?.());
}

function initAppDropdowns(root = document) {
    root.querySelectorAll('select[data-app-dropdown]:not([data-dropdown-ready])').forEach(select => {
        select.dataset.dropdownReady = 'true';

        const wrapper = document.createElement('span');
        wrapper.className = 'app-dropdown';
        if (select.classList.contains('date-select')) wrapper.classList.add('app-date-dropdown');
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'app-dropdown-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.innerHTML = '<span class="app-dropdown-value"></span><span class="app-dropdown-chevron" aria-hidden="true"></span>';

        const menu = document.createElement('div');
        menu.className = 'app-dropdown-menu';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;
        wrapper.append(trigger);
        document.body.appendChild(menu);
        wrapper._dropdownMenu = menu;

        const close = () => {
            menu.hidden = true;
            wrapper.classList.remove('open', 'open-up');
            trigger.setAttribute('aria-expanded', 'false');
        };

        const positionMenu = () => {
            wrapper.classList.remove('open-up');
            positionAnchoredOverlay(trigger, menu);
            menu.style.maxHeight = '124px';
        };

        const sync = () => {
            const selected = select.options[select.selectedIndex];
            trigger.querySelector('.app-dropdown-value').textContent = selected ? selected.textContent : '';
            trigger.disabled = select.disabled;
            trigger.setAttribute('aria-label', select.title || selected?.textContent || '선택');
            menu.replaceChildren();

            Array.from(select.options).forEach((option, index) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'app-dropdown-option';
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', String(index === select.selectedIndex));
                item.dataset.value = option.value;
                item.textContent = option.textContent;
                item.disabled = option.disabled;
                item.addEventListener('click', () => {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    sync();
                    close();
                    trigger.focus();
                });
                menu.appendChild(item);
            });
        };
        wrapper._dropdownSync = sync;

        trigger.addEventListener('click', () => {
            const willOpen = menu.hidden;
            document.querySelectorAll('.app-dropdown.open').forEach(openDropdown => {
                if (openDropdown !== wrapper) openDropdown._dropdownMenu.hidden = true;
                openDropdown.classList.remove('open', 'open-up');
                openDropdown.querySelector('.app-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
            });
            if (!willOpen) {
                close();
                return;
            }
            sync();
            menu.hidden = false;
            wrapper.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
            positionMenu();
            menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
        });

        trigger.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Escape') {
                close();
                return;
            }
            if (menu.hidden) trigger.click();
            const enabled = Array.from(menu.querySelectorAll('.app-dropdown-option:not(:disabled)'));
            const current = enabled.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
                event.key === 'ArrowUp' ? Math.max(0, current < 0 ? enabled.length - 1 : current - 1) :
                Math.min(enabled.length - 1, current + 1);
            enabled[next]?.focus();
        });

        select.addEventListener('change', sync);
        new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });

        const containingLabel = select.closest('label') ||
            (select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"], label[data-dropdown-label="${CSS.escape(select.id)}"]`) : null);
        if (containingLabel) {
            containingLabel.addEventListener('click', event => {
                if (wrapper.contains(event.target)) return;
                event.preventDefault();
                event.stopPropagation();
                trigger.focus();
                trigger.click();
            });
        }
        sync();
    });
}

function initAppTemporalInputs(root = document) {
    root.querySelectorAll('input[type="date"]:not([data-temporal-ready]), input[type="time"]:not([data-temporal-ready])').forEach(input => {
        input.dataset.temporalReady = 'true';
        const type = input.type;
        const wrapper = document.createElement('span');
        wrapper.className = `app-temporal app-temporal-${type}`;
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'app-temporal-trigger';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.innerHTML = '<span class="app-temporal-value"></span><span class="app-temporal-icon" aria-hidden="true"></span>';

        const menu = document.createElement('div');
        menu.className = 'app-temporal-menu';
        menu.hidden = true;
        wrapper.append(trigger);
        document.body.appendChild(menu);
        wrapper._temporalMenu = menu;

        const pad = value => String(value).padStart(2, '0');
        const valueText = () => {
            if (!input.value) return type === 'date' ? '날짜 선택' : '시간 선택';
            if (type === 'time') return input.value;
            const [year, month, day] = input.value.split('-');
            return `${year}.${month}.${day}`;
        };
        const sync = () => {
            trigger.querySelector('.app-temporal-value').textContent = valueText();
            trigger.disabled = input.disabled;
        };
        wrapper._temporalSync = sync;

        const close = () => {
            menu.hidden = true;
            wrapper.classList.remove('open', 'open-up');
            trigger.setAttribute('aria-expanded', 'false');
        };
        const position = () => {
            wrapper.classList.remove('open-up');
            positionAnchoredOverlay(trigger, menu);
            menu.style.height = '112px';
            menu.style.maxHeight = '';
        };
        wrapper._temporalPosition = position;
        const selectedDateParts = () => {
            const today = new Date();
            const parts = input.value ? input.value.split('-').map(Number) : [today.getFullYear(), today.getMonth() + 1, today.getDate()];
            return { year: parts[0], month: parts[1], day: parts[2] };
        };
        const selectedTimeParts = () => {
            const now = new Date();
            const parts = input.value ? input.value.split(':').map(Number) : [now.getHours(), now.getMinutes()];
            return { hour: parts[0], minute: parts[1] };
        };
        const optionButton = (text, selected, onClick) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'app-temporal-option';
            button.textContent = text;
            button.setAttribute('aria-selected', String(selected));
            button.addEventListener('click', event => {
                event.stopPropagation();
                onClick(event);
            });
            return button;
        };
        const renderDate = state => {
            menu.replaceChildren();
            const columns = document.createElement('div');
            columns.className = 'app-temporal-columns date-columns';
            const yearColumn = document.createElement('div');
            const monthColumn = document.createElement('div');
            const dayColumn = document.createElement('div');
            [yearColumn, monthColumn, dayColumn].forEach(column => column.className = 'app-temporal-column');
            const minYear = input.min ? Number(input.min.slice(0, 4)) : state.year - 8;
            const maxYear = input.max ? Number(input.max.slice(0, 4)) : state.year + 8;
            for (let year = minYear; year <= maxYear; year++) {
                yearColumn.appendChild(optionButton(`${year}년`, year === state.year, () => {
                    state.year = year;
                    state.day = Math.min(state.day, new Date(state.year, state.month, 0).getDate());
                    renderDate(state);
                }));
            }
            for (let month = 1; month <= 12; month++) {
                monthColumn.appendChild(optionButton(`${month}월`, month === state.month, () => {
                    state.month = month;
                    state.day = Math.min(state.day, new Date(state.year, state.month, 0).getDate());
                    renderDate(state);
                }));
            }
            const days = new Date(state.year, state.month, 0).getDate();
            for (let day = 1; day <= days; day++) {
                dayColumn.appendChild(optionButton(`${day}일`, day === state.day, () => {
                    const nextValue = `${state.year}-${pad(state.month)}-${pad(day)}`;
                    input.value = nextValue;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    if (input.value !== nextValue) input.value = nextValue;
                    sync();
                    close();
                    trigger.focus();
                    setTimeout(() => {
                        input.value = nextValue;
                        sync();
                    }, 0);
                }));
            }
            columns.append(yearColumn, monthColumn, dayColumn);
            menu.appendChild(columns);
            menu.querySelectorAll('[aria-selected="true"]').forEach(option => option.scrollIntoView({ block: 'center' }));
        };
        const renderTime = state => {
            menu.replaceChildren();
            const columns = document.createElement('div');
            columns.className = 'app-temporal-columns time-columns';
            const hourColumn = document.createElement('div');
            const minuteColumn = document.createElement('div');
            hourColumn.className = minuteColumn.className = 'app-temporal-column';
            for (let hour = 0; hour < 24; hour++) {
                hourColumn.appendChild(optionButton(`${pad(hour)}시`, hour === state.hour, () => {
                    const hasSavedTime = !!input.value;
                    state.hour = hour;
                    if (!hasSavedTime) state.minute = 0;
                    const nextValue = `${pad(state.hour)}:${pad(state.minute)}`;
                    input.value = nextValue;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    if (input.value !== nextValue) input.value = nextValue;
                    sync();
                    renderTime(state);
                }));
            }
            for (let minute = 0; minute < 60; minute++) {
                minuteColumn.appendChild(optionButton(`${pad(minute)}분`, minute === state.minute, () => {
                    const nextValue = `${pad(state.hour)}:${pad(minute)}`;
                    input.value = nextValue;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    if (input.value !== nextValue) input.value = nextValue;
                    sync();
                    close();
                    trigger.focus();
                    setTimeout(() => {
                        input.value = nextValue;
                        sync();
                    }, 0);
                }));
            }
            columns.append(hourColumn, minuteColumn);
            menu.appendChild(columns);
            menu.querySelectorAll('[aria-selected="true"]').forEach(option => option.scrollIntoView({ block: 'center' }));
        };

        trigger.addEventListener('click', () => {
            const willOpen = menu.hidden;
            document.querySelectorAll('.app-temporal.open').forEach(openPicker => {
                openPicker._temporalMenu.hidden = true;
                openPicker.classList.remove('open', 'open-up');
                openPicker.querySelector('.app-temporal-trigger')?.setAttribute('aria-expanded', 'false');
            });
            if (!willOpen) {
                close();
                return;
            }
            sync();
            menu.hidden = false;
            wrapper.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
            type === 'date' ? renderDate(selectedDateParts()) : renderTime(selectedTimeParts());
            position();
        });
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);
        const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
        if (label) {
            label.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                trigger.focus();
                trigger.click();
            });
        }
        sync();
    });
}

function getAppAutocompleteValues(type) {
    const values = [];
    const add = value => {
        const normalized = String(value || '').trim();
        if (normalized && !values.includes(normalized)) values.push(normalized);
    };
    const field = { load: 'loadLoc', unload: 'unloadLoc', fare: 'fare', client: 'client' }[type];
    if (type === 'client') {
        (getUserSettings().clients || []).filter(client => client.companyName).forEach(client => add(client.companyName));
    }
    [...currentTempCallDetails].reverse().forEach(item => add(item?.[field]));
    Object.keys(workData).sort().reverse().forEach(dateKey => {
        [...(workData[dateKey]?.callDetails || [])].reverse().forEach(item => add(item?.[field]));
    });
    return type === 'fare'
        ? values.map(value => parseCurrencyValue(value).toLocaleString()).filter(value => value !== '0')
        : values;
}

function initAppAutocompletes(root = document) {
    root.querySelectorAll('input[data-app-autocomplete]:not([data-autocomplete-ready])').forEach(input => {
        input.dataset.autocompleteReady = 'true';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');

        const menu = document.createElement('div');
        menu.className = 'app-autocomplete-menu';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;
        document.body.appendChild(menu);

        const close = () => {
            menu.hidden = true;
            input.setAttribute('aria-expanded', 'false');
        };
        const position = () => {
            const rect = input.getBoundingClientRect();
            const edge = 8;
            const gap = 5;
            const bottomNav = document.querySelector('.bottom-nav-bar');
            const bottomNavRect = bottomNav?.getBoundingClientRect();
            const viewportBottom = bottomNavRect && bottomNavRect.height > 0
                ? Math.min(window.innerHeight, bottomNavRect.top)
                : window.innerHeight;
            const below = viewportBottom - rect.bottom - gap - edge;
            const above = rect.top - gap - edge;
            const openUp = below < 124 && above > below;
            menu.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - rect.width - edge))}px`;
            menu.style.width = `${Math.min(rect.width, window.innerWidth - edge * 2)}px`;
            menu.style.top = openUp ? 'auto' : `${rect.bottom + gap}px`;
            menu.style.bottom = openUp ? `${window.innerHeight - rect.top + gap}px` : 'auto';
        };
        const render = () => {
            const query = input.value.trim().toLocaleLowerCase();
            const values = getAppAutocompleteValues(input.dataset.appAutocomplete)
                .filter(value => !query || value.toLocaleLowerCase().includes(query));
            menu.replaceChildren();
            values.forEach(value => {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'app-autocomplete-option';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(value === input.value.trim()));
                option.textContent = value;
                option.addEventListener('mousedown', event => event.preventDefault());
                option.addEventListener('click', () => {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    close();
                    input.focus();
                });
                menu.appendChild(option);
            });
            menu.hidden = values.length === 0;
            input.setAttribute('aria-expanded', String(values.length > 0));
            if (values.length) position();
        };

        input.addEventListener('focus', render);
        input.addEventListener('click', render);
        input.addEventListener('input', render);
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
            if (event.key === 'ArrowDown' && !menu.hidden) {
                event.preventDefault();
                menu.querySelector('.app-autocomplete-option')?.focus();
            }
        });
        input._autocompleteMenu = menu;
        input._autocompleteClose = close;
        input._autocompletePosition = position;
    });
}

document.addEventListener('click', event => {
    document.querySelectorAll('.app-dropdown.open').forEach(wrapper => {
        if (!wrapper.contains(event.target) && !wrapper._dropdownMenu?.contains(event.target)) {
            wrapper._dropdownMenu.hidden = true;
            wrapper.classList.remove('open', 'open-up');
            wrapper.querySelector('.app-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
        }
    });
    document.querySelectorAll('.app-temporal.open').forEach(wrapper => {
        if (!wrapper.contains(event.target) && !wrapper._temporalMenu?.contains(event.target)) {
            wrapper._temporalMenu.hidden = true;
            wrapper.classList.remove('open', 'open-up');
            wrapper.querySelector('.app-temporal-trigger')?.setAttribute('aria-expanded', 'false');
        }
    });
    document.querySelectorAll('input[data-app-autocomplete][aria-expanded="true"]').forEach(input => {
        if (event.target !== input && !input._autocompleteMenu?.contains(event.target)) input._autocompleteClose?.();
    });
});

window.addEventListener('resize', refreshOpenAnchoredOverlays);
window.addEventListener('scroll', event => {
    if (event.target instanceof Element && event.target.closest('.app-dropdown-menu, .app-temporal-menu')) return;
    refreshOpenAnchoredOverlays();
}, true);
window.visualViewport?.addEventListener('resize', refreshOpenAnchoredOverlays);
window.visualViewport?.addEventListener('scroll', refreshOpenAnchoredOverlays);

function initBackdropDismissModals() {
    const dismissHandlers = {
        callDetailModal: closeCallDetailModal,
        detailReportSelectModal: closeDetailReportModal,
        maintFuelSelectModal: closeMaintFuelSelectModal,
        fuelDetailModal: closeFuelDetailModal,
        maintRecordModal: closeMaintRecordModal,
        carModal: closeCarModal,
        reportCarSelectModal: closeReportCarSelectModal,
        reportShareModal: closeReportShareModal,
        clientModal: cancelClientModal,
        confirmModal: closeConfirmModal
    };

    Object.entries(dismissHandlers).forEach(([modalId, dismiss]) => {
        const modal = document.getElementById(modalId);
        if (!modal || modal.dataset.backdropDismissReady === 'true') return;

        modal.dataset.backdropDismissReady = 'true';
        modal.addEventListener('click', event => {
            if (event.target !== modal || modal.classList.contains('inline-expanded')) return;
            dismiss();
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initAppDropdowns();
    initAppTemporalInputs();
    initAppAutocompletes();
    initBackdropDismissModals();
    setupMobileBackIntegration();
    new MutationObserver(() => {
        document.querySelectorAll('.app-temporal').forEach(wrapper => wrapper._temporalSync?.());
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
});

// 화면 디자인을 바꾸지 않고 폼 요소의 접근성 이름을 보완한다.
function enhanceAccessibility() {
    document.querySelectorAll('img:not([alt])').forEach(image => {
        image.alt = '';
    });

    document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(field => {
        if (field.labels && field.labels.length > 0) return;
        if (field.hasAttribute('aria-label') || field.hasAttribute('aria-labelledby')) return;

        const group = field.closest('.form-group, .setting-item, .call-inline-field, .price-setting');
        const nearbyLabel = group ? group.querySelector('label') : null;
        const accessibleName = (nearbyLabel && nearbyLabel.textContent.trim())
            || field.getAttribute('placeholder')
            || field.getAttribute('title')
            || '입력 항목';

        field.setAttribute('aria-label', accessibleName);
    });
}

enhanceAccessibility();
new MutationObserver(enhanceAccessibility).observe(document.body, {
    childList: true,
    subtree: true
});

function deleteClient(idx) {
    showConfirmModal('해당 업체를 삭제하시겠습니까?', () => {
        const settings = getUserSettings();
        if (settings.clients && settings.clients[idx]) {
            const deletedSupabaseId = settings.clients[idx].supabaseId;
            settings.clients.splice(idx, 1);
            setUserSettings(settings);
            showToastMessage('삭제되었습니다.');
            renderClientList();
            buildCalendar();

            // 로컬에서만 지우고 끝내면, 재로그인/하이드레이션 시 서버 clients 테이블에 남아있는
            // 이 거래처 행을 다시 읽어와 로컬에 되살려 놓는다(차량 삭제 때 이미 한 번 확인·수정된
            // 것과 같은 종류의 결함이라 동일하게 처리) — 서버에서도 함께 삭제한다.
            if (deletedSupabaseId && typeof deleteClientFromSupabase === 'function') {
                deleteClientFromSupabase(deletedSupabaseId).catch(error => {
                    console.error('서버 거래처 삭제 실패(로컬 삭제는 반영됨, 다음 동기화 때 재확인 필요):', error);
                });
            }
        }
    });
}

function populateClientDataList() {
    const settings = getUserSettings();
    const clients = settings.clients || [];
    const dataList = document.getElementById('clientDataList');
    if (dataList) {
        dataList.innerHTML = '';
        clients.forEach(client => {
            const option = document.createElement('option');
            option.value = client.companyName;
            dataList.appendChild(option);
        });
    }
}

function populateLocationDataLists() {
    const loadLocSet = new Set();
    const unloadLocSet = new Set();

    for (let key in workData) {
        const record = workData[key];
        if (record && !record.isOff && record.callDetails) {
            record.callDetails.forEach(item => {
                if (item.loadLoc) loadLocSet.add(item.loadLoc.trim());
                if (item.unloadLoc) unloadLocSet.add(item.unloadLoc.trim());
            });
        }
    }

    const loadLocList = document.getElementById('loadLocList');
    const unloadLocList = document.getElementById('unloadLocList');

    if (loadLocList) {
        loadLocList.innerHTML = '';
        loadLocSet.forEach(loc => {
            if (loc !== '') {
                const option = document.createElement('option');
                option.value = loc;
                loadLocList.appendChild(option);
            }
        });
    }

    if (unloadLocList) {
        unloadLocList.innerHTML = '';
        unloadLocSet.forEach(loc => {
            if (loc !== '') {
                const option = document.createElement('option');
                option.value = loc;
                unloadLocList.appendChild(option);
            }
        });
    }
}

// 상차지/하차지 즐겨찾기 칩을 예전엔 따로 관리했다(pinnedLoadLocations/pinnedUnloadLocations,
// 각각 최대 5개). 실제로는 "청양 애경"처럼 상차지로도 하차지로도 쓰이는 곳이 많아서 같은
// 곳을 두 번 등록해야 하는 비효율이 있었고, 세로 공간도 두 줄을 차지했다. 하나의 목록으로
// 합치고(pinnedLocations), 대신 "지금 포커스가 상차지/하차지 중 어디에 있는지"로 어느
// 입력란에 채울지 정한다(activeLocationShortcutTarget).
let activeLocationShortcutTarget = 'load';

function setActiveLocationShortcutTarget(type) {
    activeLocationShortcutTarget = type === 'unload' ? 'unload' : 'load';
}

// 기존 pinnedLoadLocations/pinnedUnloadLocations를 쓰던 계정을 한 번만 pinnedLocations로
// 합쳐준다. 이미 pinnedLocations가 있으면(마이그레이션 끝났거나 원래 신규 계정) 손대지 않는다.
function normalizeLegacyPinnedLocations() {
    const settings = getUserSettings();
    if (Array.isArray(settings.pinnedLocations)) return;

    const merged = [];
    [...(settings.pinnedLoadLocations || []), ...(settings.pinnedUnloadLocations || [])].forEach(loc => {
        const trimmed = String(loc || '').trim();
        if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
    });
    settings.pinnedLocations = merged.slice(0, PINNED_LOCATION_LIMIT);
    delete settings.pinnedLoadLocations;
    delete settings.pinnedUnloadLocations;
    setUserSettings(settings);
}

const PINNED_LOCATION_LIMIT = 10;
const LOCATION_SHORTCUT_DISPLAY_LIMIT = 12;

// "자주 + 최근" 랭킹: 상차지/하차지 구분 없이 이 계정이 실제로 입력한 모든 장소를 세어서,
// 등장 횟수가 많은 순 → 동률이면 최근에 쓴 순으로 정렬한다. 순수 최신순으로만 하면 어쩌다
// 한 번 간 곳이 단골 노선을 밀어낼 수 있어서(실제 피드백으로 지적됨) 빈도를 먼저 본다.
function getFrequentAndRecentLocations() {
    const stats = new Map(); // location -> { count, lastIndex(작을수록 최근) }
    let cursor = 0;
    const addLocation = value => {
        const location = String(value || '').trim();
        if (!location) return;
        const entry = stats.get(location) || { count: 0, lastIndex: Infinity };
        entry.count += 1;
        entry.lastIndex = Math.min(entry.lastIndex, cursor);
        stats.set(location, entry);
        cursor += 1;
    };
    const addFromDetail = item => { addLocation(item.loadLoc); addLocation(item.unloadLoc); };

    [...currentTempCallDetails].reverse().forEach(addFromDetail);
    Object.keys(workData).sort().reverse().forEach(dateKey => {
        [...(workData[dateKey]?.callDetails || [])].reverse().forEach(addFromDetail);
    });

    return [...stats.entries()]
        .sort((a, b) => (b[1].count - a[1].count) || (a[1].lastIndex - b[1].lastIndex))
        .map(([location]) => location);
}

function renderLocationShortcuts() {
    const settings = getUserSettings();
    const pinned = Array.isArray(settings.pinnedLocations) ? settings.pinnedLocations.filter(Boolean) : [];
    const locations = [...pinned, ...getFrequentAndRecentLocations().filter(location => !pinned.includes(location))]
        .slice(0, LOCATION_SHORTCUT_DISPLAY_LIMIT);
    const container = document.getElementById('callLocShortcuts');
    if (!container) return;

    container.innerHTML = '';
    container.style.display = locations.length ? 'flex' : 'none';
    locations.forEach(location => {
        const chip = document.createElement('span');
        chip.className = `location-chip${pinned.includes(location) ? ' pinned' : ''}`;

        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'location-chip-select';
        selectButton.textContent = location;
        selectButton.addEventListener('click', () => selectLocationShortcut(location));

        const pinButton = document.createElement('button');
        pinButton.type = 'button';
        pinButton.className = 'location-chip-pin';
        pinButton.textContent = pinned.includes(location) ? '★' : '☆';
        pinButton.title = pinned.includes(location) ? '고정 해제' : '장소 고정';
        pinButton.setAttribute('aria-label', `${location} ${pinButton.title}`);
        pinButton.addEventListener('click', () => togglePinnedLocation(location));

        chip.append(selectButton, pinButton);
        container.appendChild(chip);
    });
}

// 지금 포커스가 있던(또는 마지막으로 있었던) 입력란에 채운다 — 즐겨찾기 칩 자체는 상차지용/
// 하차지용 구분이 없는 하나의 목록이라, "어느 칩이냐"가 아니라 "지금 어느 입력란을 채우려는
// 참이냐"로 대상을 정한다.
function selectLocationShortcut(location) {
    const input = document.getElementById(activeLocationShortcutTarget === 'unload' ? 'callUnloadLoc' : 'callLoadLoc');
    if (input) input.value = location;
}

function togglePinnedLocation(location) {
    const settings = getUserSettings();
    const pinned = Array.isArray(settings.pinnedLocations) ? [...settings.pinnedLocations] : [];
    const index = pinned.indexOf(location);

    if (index >= 0) {
        pinned.splice(index, 1);
    } else {
        if (pinned.length >= PINNED_LOCATION_LIMIT) {
            showToastMessage(`고정 장소는 최대 ${PINNED_LOCATION_LIMIT}개까지 등록할 수 있습니다.`);
            return;
        }
        pinned.push(location);
    }

    settings.pinnedLocations = pinned;
    setUserSettings(settings);
    renderLocationShortcuts();
}

// 같은 차량이 배열에 중복으로 들어있는 걸 정리한다. 메인 차량은 항상 최대 1대만 있어야
// 하고, 기사차량은 차량번호가 같으면 같은 차량으로 본다. 중복이 있으면 supabaseId가
// 있는(=서버에 실제로 존재가 확인된) 쪽을 우선 남긴다. cars/clients 둘 다에 재사용한다.
function dedupeEntityList(list, keyOf) {
    if (!Array.isArray(list)) return { list: [], removed: 0 };
    const chosen = new Map();
    const order = [];
    list.forEach(item => {
        if (!item) return;
        const key = keyOf(item);
        if (!chosen.has(key)) {
            chosen.set(key, item);
            order.push(key);
            return;
        }
        const existing = chosen.get(key);
        if (!existing.supabaseId && item.supabaseId) chosen.set(key, item);
    });
    const deduped = order.map(key => chosen.get(key));
    return { list: deduped, removed: list.length - deduped.length };
}

function dedupeCars(cars) {
    const { list, removed } = dedupeEntityList(cars, car => car.type === 'sub' ? `sub:${car.number || ''}` : 'main');
    return { cars: list, removed };
}

function dedupeClients(clients) {
    const { list, removed } = dedupeEntityList(clients, client => client.companyName || client.id || '');
    return { clients: list, removed };
}

function loadCarList() {
    const settings = getUserSettings();

    if (!settings.cars) {
        settings.cars = [];
        if (settings.carNumber) {
            settings.cars.push({ number: settings.carNumber, tonnage: settings.carTonnage || '', type: 'main' });
            delete settings.carNumber;
            delete settings.carTonnage;
            setUserSettings(settings);
        }
    }

    // 중복된 차량 항목(같은 메인 차량 여러 개, 또는 번호가 같은 기사차량 여러 개)이 있으면
    // 정리한다 — supabaseId가 저장 때마다 사라지던 예전 버그 등으로 실제 중복이 쌓이는
    // 문제가 있었다. 화면에는 항상 차량마다 한 줄만 보이도록 열 때마다 다시 정리한다.
    const { cars: dedupedCars, removed } = dedupeCars(settings.cars);
    if (removed > 0) {
        settings.cars = dedupedCars;
        setUserSettings(settings);
        showToastMessage(`중복된 차량 항목 ${removed}건을 정리했습니다.`);
    }

    const container = document.getElementById('carListContainer');
    container.innerHTML = '';

    if (settings.cars.length === 0) {
        container.innerHTML = '<div class="empty-state">등록된 차량이 없습니다.</div>';
    } else {
        settings.cars.forEach((car, idx) => {
            const typeBadge = car.type === 'main' 
                ? '<span class="management-badge car-type main">메인</span>' 
                : '<span class="management-badge car-type sub">기사차량</span>';
            
            const savedDriverName = car.driverName || car.personalInfo?.driverName || '';
            const driverInfo = car.type === 'sub' && savedDriverName ? ` [기사: ${savedDriverName}]` : '';
            const settlementBadge = car.type === 'sub' ? `<span class="management-badge commission">${escapeDetailText(getDriverSettlementModeMeta(getEffectiveDriverSettlementMode(car, settings)).label)}</span>` : '';

            const div = document.createElement('div');
            div.className = 'car-card management-list-card car-list-card';
            div.innerHTML = `
                <div class="management-card-copy">
                    <div class="car-info-text">${typeBadge}${escapeDetailText(car.number)}${escapeDetailText(driverInfo)}${settlementBadge}${car.type === 'sub' && car.driverLinkEnabled ? '<span class="management-badge log-enabled">기사연동</span>' : ''}${car.type === 'sub' && car.logEnabled ? '<span class="management-badge log-enabled">운행일지</span>' : ''}</div>
                    <div class="car-sub-text">${car.tonnage ? '(' + escapeDetailText(car.tonnage) + ')' : ''}${car.commEnabled && car.commission ? ' · 수수료 ' + escapeDetailText(car.commission) + (car.commType === 'direct' ? '원' : '%') : ''}</div>
                </div>
                <div class="car-action-btns">
                    <button type="button" class="action-icon-btn" onclick="editCar(${idx})" title="수정">${editDetailSvg()}</button>
                    <button type="button" class="action-icon-btn del" onclick="deleteCar(${idx})" title="삭제">${deleteDetailSvg()}</button>
                </div>
            `;
            container.appendChild(div);
        });
    }
}

function toggleCarAddMenu() {
    document.getElementById('carAddMenu')?.classList.toggle('hidden');
}

function closeCarAddMenu() {
    document.getElementById('carAddMenu')?.classList.add('hidden');
}

function openCarModal(mode = 'main') {
    resetCarForm();
    const modeEl = document.getElementById('carModalMode');
    if (modeEl) modeEl.value = mode;

    const settings = getUserSettings();
    const cars = settings.cars || [];

    if (mode === 'main') {
        // 소속 기사는 메인 차량이 곧 "차주가 연동해 준 그 차량"이어야 한다(운행기록이 그
        // 차량으로 올라가야 차주가 조회할 수 있다 — resolveVehicleIdForLogId 참고). 아직
        // 차주와 연동 전인데 기사가 직접 메인 차량을 새로 등록해 버리면, 나중에 연동해도
        // 이 임의의 차량과 실제 차주 차량이 서로 다른 두 대처럼 꼬여서 운행기록이 갈라지는
        // 문제가 생긴다 — 그래서 연동 전에는 메인 차량 등록 자체를 막고 먼저 연동하게 한다.
        if (settings.accountType === 'employed_driver' && settings.employerLink?.status !== 'linked' && editingCarIndex < 0) {
            showConfirmModal('아직 소속 사장님과 연결되지 않았습니다.\n마이페이지 > 소속 연결에서 먼저 사장님과 연결한 뒤 차량 정보를 등록해 주세요.', null);
            return;
        }
        let hasMain = cars.some((c, idx) => idx !== editingCarIndex && c.type === 'main');
        if (hasMain && editingCarIndex < 0) {
            showConfirmModal('메인 차량이 이미 등록되어 있습니다.', null);
            return;
        }
        document.getElementById('carModalTitle').textContent = '차량 등록';
        document.getElementById('driverBasicInfoFields').style.display = 'none';
        document.getElementById('carBusinessInfoFields').style.display = 'none';
        document.getElementById('logToggleContainer').style.display = 'none';
    } else {
        let subCount = cars.filter((c, idx) => idx !== editingCarIndex && c.type === 'sub').length;
        if (subCount >= 3 && editingCarIndex < 0) {
            showConfirmModal('기사 차량은 최대 3대까지 등록 가능합니다.', null);
            return;
        }
        document.getElementById('carModalTitle').textContent = '기사 등록';
        document.getElementById('driverBasicInfoFields').style.display = 'block';
        document.getElementById('carBusinessInfoFields').style.display = 'block';
        document.getElementById('logToggleContainer').style.display = 'block';
    }

    document.getElementById('carModal').classList.remove('hidden');
}

function closeCarModal() {
    document.getElementById('carModal').classList.add('hidden');
    resetCarForm();
}

function setCarCommType(type) {
    const hiddenType = document.getElementById('newCarCommType');
    const previousType = hiddenType?.value || 'percent';
    if (hiddenType) hiddenType.value = type;

    const btnPercent = document.getElementById('btnCarCommPercent');
    const btnDirect = document.getElementById('btnCarCommDirect');
    const label = document.getElementById('carCommLabel');
    const input = document.getElementById('newCarCommission');
    const unit = document.getElementById('carCommUnit');

    if (!btnPercent || !btnDirect || !label || !input || !unit) return;
    if (previousType !== type) input.value = '';

    if (type === 'percent') {
        btnPercent.classList.add('active');
        btnDirect.classList.remove('active');
        btnPercent.setAttribute('aria-pressed', 'true');
        btnDirect.setAttribute('aria-pressed', 'false');
        label.textContent = '기사(차량) 수수료율';
        input.placeholder = '0';
        input.inputMode = 'decimal';
        unit.textContent = '%';
        let val = input.value.replace(/[^0-9.]/g, '');
        if (parseFloat(val) > 100) val = '100';
        input.value = val;
    } else {
        btnDirect.classList.add('active');
        btnPercent.classList.remove('active');
        btnDirect.setAttribute('aria-pressed', 'true');
        btnPercent.setAttribute('aria-pressed', 'false');
        label.textContent = '기사(차량) 건당 수수료';
        input.placeholder = '0';
        input.inputMode = 'numeric';
        unit.textContent = '원';
        formatCurrencyInput(input);
    }
}

function formatCarCommInput(input) {
    const typeEl = document.getElementById('newCarCommType');
    const type = typeEl ? typeEl.value : 'percent';
    if (type === 'percent') {
        formatCommValue(input);
    } else {
        formatCurrencyInput(input);
    }
}

function toggleNewCarCommSettings() {
    const isChecked = document.getElementById('newCarCommToggle').checked;
    setSettingsGroupExpanded(document.getElementById('newCarCommSettings'), isChecked);
}

// 기사차량(sub car)의 차량 단위 사업자정보를 읽는다. "내 사업자 정보와 동일" ON이면 값을
// 저장/스냅샷하지 않고, 조회 시점에 항상 차주의 최신 개인정보 사업자정보를 그대로 참조한다
// (차주가 나중에 주소/이메일 등을 고쳐도 "동일" 차량들이 자동으로 최신값을 따라가야 하므로).
// 메인 차량은 애초에 차주 본인 사업자를 쓰는 것이 기본이라 항상 차주 기본 사업자정보를 쓴다.
function getCarBusinessInfo(car, settings = getUserSettings()) {
    const ownerBiz = {
        name: settings.bizName || '',
        bizNumber: settings.bizNumber || '',
        representative: settings.bizRepresentative || settings.userName || '',
        address: settings.bizAddress || '',
        bizType: settings.bizType || '',
        bizItem: settings.bizItem || '',
        email: settings.bizEmail || ''
    };
    if (!car || car.type !== 'sub') return { sameAsOwner: true, ...ownerBiz };

    const info = car.businessInfo;
    // 기존 차량(이번 기능 이전에 등록됨)은 businessInfo가 아예 없다 — "사업자정보 미설정"이
    // 아니라 안전하게 "차주와 동일"로 취급해서 이전과 동일하게 차주 기본 사업자를 쓴다(요구사항 11:
    // 기존 차량은 오류 없이 정상 동작해야 한다).
    if (!info || info.sameAsOwner) return { sameAsOwner: true, ...ownerBiz };

    return {
        sameAsOwner: false,
        name: info.name || '',
        bizNumber: info.bizNumber || '',
        representative: info.representative || '',
        address: info.address || '',
        bizType: info.bizType || '',
        bizItem: info.bizItem || '',
        email: info.email || ''
    };
}

// 이 차량의 운행 매출을 차주의 "월매출" 화면에서 볼 수 있는지 여부. 값이 아예 없으면(기존
// 차량) 항상 true로 취급한다 — 이 기능 도입 전에는 전부 보였으므로 기존 동작을 그대로 유지.
function isVehicleRevenueSharedWithOwner(car) {
    return car?.shareRevenueWithOwner !== false;
}

// 세금계산서(매출 발행) 집계에서 "이 운행이 어느 사업자 명의로 나가야 하는지" 식별한다.
// - 메인 차량, 또는 "내 사업자 정보와 동일" ON인 기사차량 → 차주 기본 사업자와 같은 키를
//   부여해서, 서로 다른 차량이라도 실제로는 같은 사업자라면 하나의 계산서로 자연스럽게
//   합산되게 한다(요구사항 18의 "차량이 달라도 동일 사업자면 합산 가능" 부분).
// - 사업자정보를 따로 입력한 기사차량 → bizNumber(없으면 상호명) 기준의 고유 키를 부여해서
//   다른 사업자와 절대 섞이지 않게 한다.
// - 그마저도 없는(아직 사업자정보를 안 채운) 기사차량 → 차량번호 기준으로 키를 만들어, 서로
//   다른 미입력 차량끼리도 섞이지 않게 한다(요구사항 18: "합치는 것보다 분리를 우선한다").
function getVehicleSupplierIdentity(car, settings = getUserSettings()) {
    const ownerBiz = { sameAsOwner: true, name: settings.bizName || '', bizNumber: settings.bizNumber || '', representative: settings.bizRepresentative || settings.userName || '', address: settings.bizAddress || '', bizType: settings.bizType || '', bizItem: settings.bizItem || '', email: settings.bizEmail || '' };
    if (!car || car.type !== 'sub') {
        return { key: `owner:${ownerBiz.bizNumber || ownerBiz.name || 'default'}`, biz: ownerBiz, carLabel: '메인 차량', carNumber: null };
    }
    const biz = getCarBusinessInfo(car, settings);
    if (biz.sameAsOwner) {
        return { key: `owner:${ownerBiz.bizNumber || ownerBiz.name || 'default'}`, biz: ownerBiz, carLabel: getShortCarNum(car.number), carNumber: car.number };
    }
    const key = `car:${car.number}:${biz.bizNumber || biz.name || 'noinfo'}`;
    return { key, biz, carLabel: biz.name ? `${biz.name} · ${getShortCarNum(car.number)}` : getShortCarNum(car.number), carNumber: car.number };
}

// 차량 등록 모달의 입력값을 검증하고 settings.cars에 반영(추가/수정)까지 마친 뒤 저장된 차량과
// 인덱스를 반환한다. 검증 실패 시 필드 에러 + 토스트만 띄우고 null을 반환한다. "저장" 버튼
// (saveNewCar)과 "기사 연동하기" 버튼(openCarDriverInviteModal) 둘 다 이 함수를 공유한다 —
// 기사연동하기도 결국 차량을 먼저 정상 저장해야 실제 vehicle_id를 만들 수 있기 때문이다.
function saveCarFromModal() {
    const num = document.getElementById('newCarNumber').value.trim();
    const ton = document.getElementById('newCarTonnage').value.trim();
    const mode = document.getElementById('carModalMode').value;

    if (!num) {
        markFieldError('newCarNumber');
        document.getElementById('newCarNumber').focus();
        return null;
    }

    const carType = mode === 'main' ? 'main' : 'sub';
    const settings = getUserSettings();
    if (!settings.cars) settings.cars = [];

    const driverName = carType === 'sub' ? document.getElementById('newDriverName').value.trim() : '';
    const driverPhone = carType === 'sub' ? document.getElementById('newUserPhone').value.trim() : '';
    const settlementMode = carType === 'sub' ? document.getElementById('newCarSettlementMode').value : 'default';
    if (carType === 'sub' && (!driverName || driverPhone.replace(/\D/g, '').length < 10)) {
        if (!driverName) markFieldError('newDriverName');
        if (driverPhone.replace(/\D/g, '').length < 10) markFieldError('newUserPhone');
        showToastMessage('기사명과 연락처를 확인해 주세요.');
        return null;
    }

    const previousCar = editingCarIndex > -1 ? settings.cars[editingCarIndex] : null;
    // 기사 초대의 생성/수정/해제는 "기사 연동 관리"(및 이 모달의 2차 기사연동 모달) 쪽 실제
    // Supabase 연동 로직 한 곳에서만 한다. 여기서는 기존에 이미 연결/초대된 상태가 있으면 그
    // 상태만 읽어서 표시용으로만 쓰고, 새로 만들거나 바꾸지 않는다.
    const links = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
    const existingLink = links.find(link =>
        (previousCar?.driverLinkId && link.id === previousCar.driverLinkId)
        || (!previousCar?.driverLinkId && previousCar?.number && link.vehicleNumber === previousCar.number && link.status !== 'disconnected')
    ) || null;
    const driverLinkId = existingLink?.id || '';
    const driverLinkEnabled = carType === 'sub' && !!existingLink;
    const logEnabled = carType === 'main' ? true : (!driverLinkEnabled && document.getElementById('newLogToggle').checked);
    const insuranceOn = carType === 'sub' ? document.getElementById('newCarInsuranceToggle').checked : false;

    const commEnabled = document.getElementById('newCarCommToggle') ? document.getElementById('newCarCommToggle').checked : false;
    const commType = document.getElementById('newCarCommType').value;
    const commission = commEnabled ? document.getElementById('newCarCommission').value.trim() : '';

    // 차량 단위 사업자정보(기사 본인 개인정보 — 이름/연락처/은행/계좌 — 와는 완전히 다른
    // 개념이다. car.personalInfo가 "기사 개인" 정보라면, car.businessInfo는 "이 차량이 속한
    // 사업자"다). "내 사업자 정보와 동일" ON이면 값은 스냅샷하지 않고 플래그만 저장한다 —
    // 조회 시점에 항상 차주의 최신 개인정보를 참조하게(getCarBusinessInfo) 하기 위함.
    // personalInfo(아래)가 대표자명/사업자번호를 이 값에서 그대로 가져다 쓰므로, personalInfo
    // 구성보다 먼저 계산해 둔다.
    let businessInfo = previousCar?.businessInfo || null;
    let shareRevenueWithOwner = previousCar?.shareRevenueWithOwner;
    if (carType === 'sub') {
        const sameAsOwner = document.getElementById('newCarBizSameAsOwner')?.checked ?? true;
        businessInfo = {
            sameAsOwner,
            name: sameAsOwner ? '' : (document.getElementById('newCarBizName')?.value.trim() || ''),
            bizNumber: sameAsOwner ? '' : (document.getElementById('newCarBizNumber')?.value.trim() || ''),
            representative: sameAsOwner ? '' : (document.getElementById('newCarBizRepresentative')?.value.trim() || ''),
            address: sameAsOwner ? '' : (document.getElementById('newCarBizAddress')?.value.trim() || ''),
            bizType: sameAsOwner ? '' : (document.getElementById('newCarBizType')?.value.trim() || ''),
            bizItem: sameAsOwner ? '' : (document.getElementById('newCarBizItem')?.value.trim() || ''),
            email: sameAsOwner ? '' : (document.getElementById('newCarBizEmail')?.value.trim() || '')
        };
        shareRevenueWithOwner = document.getElementById('newCarShareRevenueToggle')?.checked ?? true;
    }

    let infoType = 'existing';
    let personalInfo = null;

    if (carType === 'sub' && logEnabled) {
        const isNewInfo = document.getElementById('btnUseNewInfo').classList.contains('active-work');
        if (isNewInfo) {
            infoType = 'new';
            // 대표자명/사업자번호는 더 이상 여기서 다시 입력받지 않는다(요구사항: 운행일지의
            // 중복 정산정보 입력 제거) — 위에서 계산한 이 차량의 사업자정보(businessInfo,
            // "내 사업자와 동일"이면 차주 기본 사업자)를 그대로 가져다 쓴다. 기존
            // getTaxInvoicePartyInfo(기사 매입 계산서)가 car.personalInfo.name/bizNumber를
            // 그대로 참조하므로, 여기서 값을 채워 둬야 기존 계산이 그대로 유지된다.
            const resolvedBiz = getCarBusinessInfo({ businessInfo, type: 'sub' }, settings);
            personalInfo = {
                driverName: driverName,
                name: resolvedBiz.representative || '',
                bizNumber: resolvedBiz.bizNumber || '',
                phone: driverPhone,
                bank: document.getElementById('newBankName').value.trim(),
                account: document.getElementById('newAccountNumber').value.trim(),
                accountHolder: document.getElementById('newAccountHolder')?.value.trim() || ''
            };
        }
    }

    // previousCar를 베이스로 스프레드해야 한다 — 그렇지 않으면 이 폼이 모르는 필드(특히
    // Supabase에 연결된 뒤 붙는 supabaseId)가 저장할 때마다 사라진다. supabaseId가 사라지면
    // 다음 저장 때 "새 차량"으로 오인해서 서버에 중복 insert되고, 그 상태에서 새로고침/재로그인
    // (하이드레이션)할 때마다 중복된 행이 전부 로컬로 다시 들어와 차량 목록이 계속 불어난다
    // (실제로 이 버그로 "차량이 무한증식"하는 문제가 재현되어 고쳤다).
    const carData = {
        ...(previousCar || {}),
        number: num,
        tonnage: ton,
        type: carType,
        driverName: driverName,
        driverPhone: driverPhone,
        settlementMode: settlementMode,
        driverLinkEnabled: driverLinkEnabled,
        driverLinkId: driverLinkEnabled ? driverLinkId : '',
        logEnabled: logEnabled,
        insuranceOn: insuranceOn,
        commType: commType,
        commission: commission,
        commEnabled: commEnabled,
        infoType: infoType,
        personalInfo: personalInfo,
        businessInfo: businessInfo,
        shareRevenueWithOwner: shareRevenueWithOwner
    };

    // 기존 서브 차량의 번호를 수정한 경우(오타 정정 등), 그 번호를 키로 쓰는 로컬 운행기록
    // 저장소(workData_<번호>)도 함께 옮겨준다 — 안 옮기면 번호만 바뀌고 실제 기록은 옛
    // 번호 키에 그대로 남아, 새 번호로 들어가면 텅 빈 일지처럼 보이는 문제가 있었다.
    if (carType === 'sub' && previousCar?.number && previousCar.number !== num) {
        const oldKey = 'workData_' + previousCar.number;
        const newKey = 'workData_' + num;
        const oldData = localStorage.getItem(oldKey);
        if (oldData && !localStorage.getItem(newKey)) {
            localStorage.setItem(newKey, oldData);
            localStorage.removeItem(oldKey);
        }
        // activeLogId가 지금 수정 중인 이전 차량번호를 가리키고 있었다면 새 번호로 갱신한다.
        if (activeLogId === previousCar.number) {
            activeLogId = num;
        }
    }

    const wasNew = editingCarIndex <= -1;
    let index;
    if (!wasNew) {
        settings.cars[editingCarIndex] = carData;
        index = editingCarIndex;
    } else {
        settings.cars.push(carData);
        index = settings.cars.length - 1;
    }
    // 새로 만든 차량이라도 이 시점부터는 "편집 중인 차량"으로 취급한다 — 이래야 "기사
    // 연동하기"가 실패해서 모달이 다시 열려도 saveCarFromModal()을 재호출했을 때 같은
    // 차량을 계속 수정하지, 매번 새 차량을 또 push해서 중복이 생기지 않는다.
    editingCarIndex = index;

    setUserSettings(settings);
    return { car: settings.cars[index], index, wasNew };
}

function saveNewCar() {
    const result = saveCarFromModal();
    if (!result) return;
    showToastMessage(result.wasNew ? '등록되었습니다.' : '수정되었습니다.');
    closeCarModal();
    loadCarList();
    renderSubCarMenu();
    renderLinkedDriverList();
    updateAccountRoleUI();
    updateTransportSettingsUI();
}

// "기사 연동하기" 버튼 핸들러. 차량을 먼저 정상 저장한 뒤, 디바운스된 배경 동기화를 기다리지
// 않고 이 차량 하나만 즉시 Supabase에 반영해 실제 vehicle_id를 확보하고, 2차 기사연동 모달을
// 연다(요구사항: 저장→수정→기사연동을 사용자가 따로 할 필요 없이 한 흐름처럼 보이게).
async function openCarDriverInviteModal() {
    const result = saveCarFromModal();
    if (!result) return; // 검증 실패 — 이미 에러가 표시됐고, 차량 모달은 그대로 유지된다.
    const { car, index } = result;

    if (typeof ensureVehicleSyncedToSupabase !== 'function' || typeof getSupabaseUser !== 'function') {
        showToastMessage('클라우드 연결 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }
    const user = await getSupabaseUser();
    if (!user) {
        showToastMessage('기사 연동은 로그인 후 이용할 수 있습니다.');
        return;
    }

    const btn = document.getElementById('carModalDriverConnectBtn');
    if (btn) { btn.disabled = true; btn.textContent = '차량 저장 중...'; }
    try {
        await ensureVehicleSyncedToSupabase(car, index);
        // ensureVehicleSyncedToSupabase가 car.supabaseId를 즉시 채워준다 — localStorage에도
        // 반영해서 이후 로직(2차 모달의 upsertDriverLinkOnSupabase 등)이 바로 쓸 수 있게 한다.
        const settings = getUserSettings();
        if (settings.cars?.[index]) {
            settings.cars[index] = car;
            setUserSettings(settings);
        }
    } catch (error) {
        console.error('차량 클라우드 동기화 실패(차량 정보 자체는 로컬에 저장됨):', error);
        showToastMessage('차량 정보를 클라우드에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '기사 연동하기'; }
    }

    document.getElementById('carModal').classList.add('hidden');
    showCarDriverInviteModal(car);
}

// 2차 기사연동 모달을 연다. 이미 이 차량에 pending/linked 초대가 있으면 그 상태를 그대로
// 보여주고(요구사항 25 — 중복 초대 방지), 없으면 차량 모달에서 이미 입력한 기사명/연락처를
// 그대로 전달해 새 초대를 준비한다(다시 입력하게 하지 않음).
function showCarDriverInviteModal(car) {
    const settings = getUserSettings();
    const links = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
    const existingLink = links.find(link =>
        (car.driverLinkId && link.id === car.driverLinkId)
        || (!car.driverLinkId && link.vehicleNumber === car.number && link.status !== 'disconnected')
    ) || null;

    document.getElementById('carInviteVehicleNumber').value = car.number;
    const vehicleLabel = document.getElementById('carInviteVehicleLabel');
    if (vehicleLabel) vehicleLabel.textContent = car.number;

    const banner = document.getElementById('carInviteStatusBanner');
    const saveBtn = document.getElementById('carInviteSaveBtn');
    const fullMgmtLink = document.getElementById('carInviteFullManagementLink');

    if (existingLink) {
        document.getElementById('carInviteEditId').value = existingLink.id;
        document.getElementById('carInviteDriverName').value = existingLink.driverName || '';
        document.getElementById('carInvitePhone').value = existingLink.phone || '';
        document.getElementById('carInviteCode').value = existingLink.inviteCode || '';
        document.getElementById('carInviteAssignmentStart').value = existingLink.assignmentStart || '';
        document.getElementById('carInviteAssignmentEnd').value = existingLink.assignmentEnd || '';
        if (banner) {
            banner.textContent = existingLink.status === 'linked'
                ? `이미 ${existingLink.driverName || '기사'}님과 연동되어 있습니다. 필요하면 아래 정보를 수정해 주세요.`
                : `${existingLink.driverName || '기사'}님에게 보낸 초대가 대기 중입니다(코드 ${existingLink.inviteCode || '-'}).`;
            banner.classList.remove('hidden');
        }
        if (saveBtn) saveBtn.textContent = existingLink.status === 'linked' ? '할당 정보 저장' : '초대 수정';
        fullMgmtLink?.classList.remove('hidden');
    } else {
        const info = getDriverInfoFromCar(car);
        document.getElementById('carInviteEditId').value = '';
        document.getElementById('carInviteDriverName').value = info.driverName;
        document.getElementById('carInvitePhone').value = info.driverPhone;
        document.getElementById('carInviteAssignmentStart').value = new Date().toISOString().slice(0, 10);
        document.getElementById('carInviteAssignmentEnd').value = '';
        if (banner) banner.classList.add('hidden');
        if (saveBtn) saveBtn.textContent = '초대 저장';
        fullMgmtLink?.classList.add('hidden');
        generateDriverInviteCode('carInviteCode');
    }

    document.getElementById('carDriverInviteModal').classList.remove('hidden');
}

// 2차 모달을 닫는다. reopenCarModal이 true면(취소/닫기) 1차 차량 등록 모달로 돌아간다 — 이미
// 저장된 차량정보/기사정보/사업자정보/정산옵션이 사라지지 않게(요구사항 24).
function closeCarDriverInviteModal(reopenCarModal = true) {
    document.getElementById('carDriverInviteModal').classList.add('hidden');
    if (reopenCarModal) document.getElementById('carModal').classList.remove('hidden');
}

// "전체 기사연동 관리에서 보기" — 연동 해제 등 이 2차 모달에 없는 고급 기능이 필요할 때만
// 쓰는 탈출구다. 기존 "기사 연동 관리" 전체 화면(디스커넥트/재발급 등 기존 기능 그대로)으로
// 이동한다.
function goToFullDriverConnectionManagementFromCarInviteModal() {
    const vehicleNumber = document.getElementById('carInviteVehicleNumber')?.value || '';
    document.getElementById('carDriverInviteModal').classList.add('hidden');
    closeCarModal();
    showDriverConnectionManagement('car');
    const vehicleInput = document.getElementById('linkedDriverVehicle');
    if (vehicleInput && vehicleNumber) vehicleInput.value = vehicleNumber;
}

async function saveCarDriverInvitation() {
    const name = document.getElementById('carInviteDriverName')?.value.trim() || '';
    const phone = document.getElementById('carInvitePhone')?.value.trim() || '';
    const inviteCode = document.getElementById('carInviteCode')?.value.trim() || '';
    const vehicleNumber = document.getElementById('carInviteVehicleNumber')?.value.trim() || '';
    const assignmentStart = document.getElementById('carInviteAssignmentStart')?.value || '';
    const assignmentEnd = document.getElementById('carInviteAssignmentEnd')?.value || '';
    const editId = document.getElementById('carInviteEditId')?.value || '';

    if (!name || !assignmentStart) {
        if (!name) markFieldError('carInviteDriverName');
        if (!assignmentStart) markFieldError('carInviteAssignmentStart');
        showToastMessage('기사 이름과 할당 시작일을 입력해 주세요.');
        return;
    }
    if (!/^\d{6}$/.test(inviteCode)) {
        markFieldError('carInviteCode');
        showToastMessage('"코드 생성" 버튼으로 6자리 초대 코드를 만들어 주세요.');
        return;
    }
    if (assignmentEnd && assignmentEnd < assignmentStart) {
        showToastMessage('할당 종료일은 시작일 이후로 선택해 주세요.');
        return;
    }

    const link = await performSaveLinkedDriverInvitation({ name, phone, inviteCode, vehicleNumber, assignmentStart, assignmentEnd, editId });
    if (!link) return; // 실패 이유는 이미 toast로 표시됨 — 차량/기사/사업자 정보는 그대로 유지된다.

    document.getElementById('carDriverInviteModal').classList.add('hidden');
    closeCarModal(); // 차량 등록 + 기사연동까지 전체 흐름 완료 — 목록으로 복귀
    loadCarList();
    renderLinkedDriverList();
    showToastMessage('차량 등록과 기사 연동을 모두 완료했습니다.');
}

function deleteCar(idx) {
    showConfirmModal('해당 차량을 삭제하시겠습니까? 이 차량으로 기록된 운행 내역도 함께 삭제되며 복구할 수 없습니다.', () => {
        const settings = getUserSettings();
        const deletedCar = settings.cars?.[idx];
        if (!deletedCar) return;
        const deletedCarNum = deletedCar.number;
        const deletedSupabaseId = deletedCar.supabaseId;
        const linkedDriver = (settings.driverLinks || []).find(link =>
            (deletedCar.driverLinkId && link.id === deletedCar.driverLinkId)
            || (!deletedCar.driverLinkId && link.vehicleNumber === deletedCarNum && link.status !== 'disconnected')
        );
        if (linkedDriver) {
            linkedDriver.status = 'disconnected';
            linkedDriver.updatedAt = new Date().toISOString();
            // disconnectLinkedDriver()/updateLinkedDriverStatus()와 동일하게, 로컬 상태 변경과
            // 별개로 서버 driver_links 행에도 반영한다 — 안 하면 차량을 지워도 서버상으로는
            // 계속 "연결됨"으로 남는다(syncSettingsToSupabase는 driver_links 테이블을 다루지
            // 않는다).
            if (linkedDriver.supabaseId && typeof updateDriverLinkStatusOnSupabase === 'function') {
                updateDriverLinkStatusOnSupabase(linkedDriver.supabaseId, 'disconnected').catch(error => {
                    console.error('기사 연동 상태 서버 반영 실패:', error);
                });
            }
        }
        settings.cars.splice(idx, 1);
        setUserSettings(settings);

        // 이 차량으로 저장된 운행 기록도 함께 삭제한다. 메인 차량은 접두사 없는 'workData'
        // 키를 공용으로 쓰므로(서브 차량과 저장 구조 자체가 다름) 대상에서 제외한다 —
        // 메인 로그 전체를 지워버리는 사고를 막기 위함.
        if (deletedCar.type !== 'main') {
            localStorage.removeItem('workData_' + deletedCarNum);
        }
        // 이 차량의 동기화 diff 기준점도 함께 지운다 — 안 지우면 나중에 같은 차량번호로
        // 새 차량을 등록했을 때, 예전 차량의 "이미 서버와 동일함" 기록이 남아있어 새 차량의
        // 실제 첫 저장이 조용히 스킵될 수 있다(§오늘 찾은 __supabaseWorkDataSyncedSnapshot 패턴).
        if (typeof __supabaseWorkDataSyncedSnapshot === 'object' && __supabaseWorkDataSyncedSnapshot) {
            delete __supabaseWorkDataSyncedSnapshot[deletedCarNum];
        }

        // 로컬에서만 지우고 끝내면, 재로그인/하이드레이션 시 서버 vehicles 테이블에 남아있는
        // 이 차량 행을 다시 읽어와 로컬에 되살려 놓는 문제가 있었다(실제로 재현됨) — 서버에서도
        // 함께 삭제해서 "새로고침하면 삭제한 차량이 부활하는" 결함을 막는다.
        if (deletedSupabaseId && typeof deleteVehicleFromSupabase === 'function') {
            deleteVehicleFromSupabase(deletedSupabaseId).catch(error => {
                console.error('서버 차량 삭제 실패(로컬 삭제는 반영됨, 다음 동기화 때 재확인 필요):', error);
            });
        }

        if (editingCarIndex === idx) resetCarForm();
        loadCarList();
        renderSubCarMenu();
        renderLinkedDriverList();
        updateAccountRoleUI();
        updateTransportSettingsUI();

        if(activeLogId === deletedCarNum) {
            switchCarLog('main');
        }
        showToastMessage('차량을 삭제했습니다.');
    });
}

function showMaintFuelManagement(tab = 'maint', returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('maintManagementPage').classList.remove('hidden');

    maintViewDate = new Date(viewDate.getTime());
    fuelViewDate = new Date(viewDate.getTime());
    miscViewDate = new Date(viewDate.getTime());

    updateMaintDateSelects();
    updateFuelDateSelects();
    updateMiscDateSelects();
    selectMaintFuelTab(tab);
}

function selectMaintFuelTab(tab) {
    const tabs = {
        maint: { btn: 'maintTabBtn', panel: 'maintTabPanel', update: updateMaintDateSelects, render: renderMaintList },
        fuel: { btn: 'fuelTabBtn', panel: 'fuelTabPanel', update: updateFuelDateSelects, render: renderFuelList },
        misc: { btn: 'miscTabBtn', panel: 'miscTabPanel', update: updateMiscDateSelects, render: renderMiscList }
    };
    const activeTab = tabs[tab] ? tab : 'maint';

    Object.keys(tabs).forEach(key => {
        const { btn, panel } = tabs[key];
        document.getElementById(btn)?.classList.toggle('active-work', key === activeTab);
        const panelEl = document.getElementById(panel);
        if (panelEl) panelEl.style.display = key === activeTab ? 'block' : 'none';
    });

    tabs[activeTab].update();
    tabs[activeTab].render();
}

function updateFuelDateSelects() {
    const yearSelect = document.getElementById('fuelYearSelect');
    const monthSelect = document.getElementById('fuelMonthSelect');
    yearSelect.value = fuelViewDate.getFullYear();
    monthSelect.value = fuelViewDate.getMonth();
    yearSelect.parentElement?._dropdownSync?.();
    monthSelect.parentElement?._dropdownSync?.();
}

function changeFuelMonth(delta) {
    fuelViewDate.setMonth(fuelViewDate.getMonth() + delta);
    updateFuelDateSelects();
    renderFuelList();
}

function changeFuelYearMonth() {
    const y = parseInt(document.getElementById('fuelYearSelect').value, 10);
    const m = parseInt(document.getElementById('fuelMonthSelect').value, 10);
    fuelViewDate.setFullYear(y);
    fuelViewDate.setMonth(m);
    renderFuelList();
}

function getActiveVehicleNumber() {
    const settings = getUserSettings();
    if (activeLogId !== 'main') {
        const currentCar = (settings.cars || []).find(c => c.number === activeLogId);
        return currentCar?.number || activeLogId;
    }
    const mainCar = (settings.cars || []).find(c => c.type === 'main');
    return mainCar?.number || settings.carNumber || '';
}

function csvEscapeCell(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// 유가보조금 신청용 주유 내역 CSV 내보내기 (해당 월의 fuelItems 기준: 날짜/차량번호/구분/주유량/금액/유가보조금/누적거리)
function exportFuelSubsidyCsv() {
    const year = fuelViewDate.getFullYear();
    const monthNumber = fuelViewDate.getMonth() + 1;
    const month = String(monthNumber).padStart(2, '0');
    const prefix = `${year}-${month}-`;
    const vehicleNumber = getActiveVehicleNumber();

    const rows = [];
    Object.keys(workData).filter(date => date.startsWith(prefix)).sort().forEach(date => {
        const items = workData[date]?.fuelItems;
        if (!items?.length) return;
        items.forEach(item => {
            rows.push([
                date,
                vehicleNumber,
                item.type || '주유',
                parseFloat(item.liter) || 0,
                parseCurrencyValue(item.cost),
                parseCurrencyValue(item.subsidy),
                item.mileage || ''
            ]);
        });
    });

    if (rows.length === 0) {
        showToastMessage('선택한 달에 주유 내역이 없습니다.');
        return;
    }

    const header = ['날짜', '차량번호', '구분', '주유량(L)', '금액(원)', '유가보조금(원)', '누적거리(km)'];
    const csvBody = [header, ...rows].map(row => row.map(csvEscapeCell).join(',')).join('\r\n');
    const csvContent = '﻿' + csvBody; // UTF-8 BOM: 엑셀에서 한글 깨짐 방지

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `${year}-${month}_${vehicleNumber || '차량'}_유가보조금신청.csv`.replace(/[\\/:*?"<>|]/g, '_');
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToastMessage('유가보조금 신청용 CSV 파일을 저장했습니다.');
}

function updateMaintDateSelects() {
    const yearSelect = document.getElementById('maintYearSelect');
    const monthSelect = document.getElementById('maintMonthSelect');
    yearSelect.value = maintViewDate.getFullYear();
    monthSelect.value = maintViewDate.getMonth();
    yearSelect.parentElement?._dropdownSync?.();
    monthSelect.parentElement?._dropdownSync?.();
}

function changeMaintMonth(delta) {
    maintViewDate.setMonth(maintViewDate.getMonth() + delta);
    updateMaintDateSelects();
    renderMaintList();
}

function changeMaintYearMonth() {
    const y = parseInt(document.getElementById('maintYearSelect').value, 10);
    const m = parseInt(document.getElementById('maintMonthSelect').value, 10);
    maintViewDate.setFullYear(y);
    maintViewDate.setMonth(m);
    renderMaintList();
}

function updateMiscDateSelects() {
    const yearSelect = document.getElementById('miscYearSelect');
    const monthSelect = document.getElementById('miscMonthSelect');
    yearSelect.value = miscViewDate.getFullYear();
    monthSelect.value = miscViewDate.getMonth();
    yearSelect.parentElement?._dropdownSync?.();
    monthSelect.parentElement?._dropdownSync?.();
}

function changeMiscMonth(delta) {
    miscViewDate.setMonth(miscViewDate.getMonth() + delta);
    updateMiscDateSelects();
    renderMiscList();
}

function changeMiscYearMonth() {
    const y = parseInt(document.getElementById('miscYearSelect').value, 10);
    const m = parseInt(document.getElementById('miscMonthSelect').value, 10);
    miscViewDate.setFullYear(y);
    miscViewDate.setMonth(m);
    renderMiscList();
}

function restoreMaintFuelModalToRoot(panel) {
    if (!panel || panel.parentElement === document.body) return;
    const previousHost = panel.parentElement;
    panel.classList.remove('inline-expanded', 'is-visible');
    document.body.appendChild(panel);
    if (previousHost?.id === 'maintFuelInlineHost') {
        previousHost.classList.remove('is-open');
        previousHost.setAttribute('aria-hidden', 'true');
        previousHost.style.maxHeight = '0px';
    }
}

function selectMaintCategory(btnEl, value) {
    const isAlreadySelected = !!btnEl?.classList.contains('active');
    const group = btnEl?.closest('.pill-group') || document.getElementById('maintCategoryGroup');
    group.querySelectorAll('.pill-btn').forEach(btn => btn.classList.remove('active'));
    if (btnEl && !isAlreadySelected) btnEl.classList.add('active');
    document.getElementById('maintRecordCategory').value = isAlreadySelected ? '' : value;
}

function selectMaintPayment(btnEl, value) {
    document.querySelectorAll('#maintPaymentGroup .segment-btn').forEach(btn => btn.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    document.getElementById('maintRecordPayment').value = value;
}

function openMaintRecordModal(date = null, index = null, kind = 'maint') {
    let item = null;
    const isMisc = kind === 'misc';
    const isFromWorkModal = !document.getElementById('workModal').classList.contains('hidden');
    const maintModal = document.getElementById('maintRecordModal');
    const tempItems = isMisc ? currentTempMiscItems : currentTempMaintItems;
    const dataKey = isMisc ? 'miscItems' : 'maintItems';
    const viewDate = isMisc ? miscViewDate : maintViewDate;
    const titleBase = isMisc ? '기타지출' : '정비 내역';

    if (!isFromWorkModal) restoreMaintFuelModalToRoot(maintModal);

    if (isFromWorkModal && index === null && maintModal.classList.contains('inline-expanded') && !maintModal.classList.contains('hidden')) {
        closeMaintFuelInlinePanel(maintModal);
        return;
    }

    document.getElementById('maintRecordKind').value = kind;
    document.getElementById('maintRecordNameLabel').textContent = isMisc ? '지출 항목명' : '정비 항목명';
    const mileageGroup = document.getElementById('maintRecordMileageGroup');
    if (mileageGroup) mileageGroup.style.display = isMisc ? 'none' : '';
    const maintCategoryGroup = document.getElementById('maintCategoryGroup');
    const miscCategoryGroup = document.getElementById('miscCategoryGroup');
    if (maintCategoryGroup) maintCategoryGroup.style.display = isMisc ? 'none' : '';
    if (miscCategoryGroup) miscCategoryGroup.style.display = isMisc ? '' : 'none';
    const activeCategoryGroup = isMisc ? miscCategoryGroup : maintCategoryGroup;

    if (date !== null && index !== null) {
        if (isFromWorkModal && date === selectedDateKey && tempItems[index]) {
            item = tempItems[index];
        } else if (workData[date] && workData[date][dataKey] && workData[date][dataKey][index]) {
            item = workData[date][dataKey][index];
        }
    }

    if (item !== null) {
        document.getElementById('maintRecordModalTitle').textContent = `${titleBase} 수정`;
        document.getElementById('maintRecordDate').value = date;
        document.getElementById('maintRecordName').value = item.name;
        document.getElementById('maintRecordFare').value = parseCurrencyValue(item.fare).toLocaleString();

        document.getElementById('maintRecordMileage').value = item.mileage || '';

        const category = item.category || '';
        document.getElementById('maintRecordCategory').value = category;
        (activeCategoryGroup ? activeCategoryGroup.querySelectorAll('.pill-btn') : []).forEach(btn => {
            if(btn.textContent.trim() === category) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        const payment = item.payment || '카드';
        document.getElementById('maintRecordPayment').value = payment;
        document.querySelectorAll('#maintPaymentGroup .segment-btn').forEach(btn => {
            if(btn.textContent.trim() === payment) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        document.getElementById('maintRecordOriginalDate').value = date;
        document.getElementById('maintRecordOriginalIndex').value = index;
    } else {
        document.getElementById('maintRecordModalTitle').textContent = `${titleBase} 추가`;
        const y = viewDate.getFullYear();
        const m = String(viewDate.getMonth() + 1).padStart(2, '0');
        const d = String(new Date().getDate()).padStart(2, '0');

        const currentMonth = new Date().getMonth();
        const selectedMonth = viewDate.getMonth();
        document.getElementById('maintRecordDate').value = (currentMonth === selectedMonth) ? `${y}-${m}-${d}` : `${y}-${m}-01`;

        if (isFromWorkModal && selectedDateKey) {
            document.getElementById('maintRecordDate').value = selectedDateKey;
        }

        document.getElementById('maintRecordName').value = '';
        document.getElementById('maintRecordFare').value = '';

        document.getElementById('maintRecordMileage').value = '';
        document.getElementById('maintRecordCategory').value = '';
        document.querySelectorAll('#maintCategoryGroup .pill-btn, #miscCategoryGroup .pill-btn').forEach(btn => btn.classList.remove('active'));

        document.getElementById('maintRecordPayment').value = '카드';
        document.querySelectorAll('#maintPaymentGroup .segment-btn').forEach(btn => {
            if(btn.textContent.trim() === '카드') btn.classList.add('active');
            else btn.classList.remove('active');
        });

        document.getElementById('maintRecordOriginalDate').value = '';
        document.getElementById('maintRecordOriginalIndex').value = '';
    }
    maintModal.classList.remove('hidden');
    if (isFromWorkModal) openMaintFuelInlinePanel(maintModal);
}

function openMiscRecordModal(date = null, index = null) {
    openMaintRecordModal(date, index, 'misc');
}

function closeMaintRecordModal() {
    closeMaintFuelInlinePanel(document.getElementById('maintRecordModal'));
}

function closeMiscRecordModal() {
    closeMaintRecordModal();
}

function saveMaintRecord() {
    const kind = document.getElementById('maintRecordKind')?.value === 'misc' ? 'misc' : 'maint';
    const isMisc = kind === 'misc';
    const dataKey = isMisc ? 'miscItems' : 'maintItems';
    const viewDateRef = isMisc ? miscViewDate : maintViewDate;

    const date = document.getElementById('maintRecordDate').value;
    const name = document.getElementById('maintRecordName').value.trim();
    const fare = document.getElementById('maintRecordFare').value.trim();

    const mileage = document.getElementById('maintRecordMileage').value.trim();
    const category = document.getElementById('maintRecordCategory').value;
    const payment = document.getElementById('maintRecordPayment').value;

    const origDate = document.getElementById('maintRecordOriginalDate').value;
    const origIndex = document.getElementById('maintRecordOriginalIndex').value;

    if (!date) {
        markFieldError('maintRecordDate');
        document.getElementById('maintRecordDate').focus();
        return;
    }
    if (!name && !fare) {
        // 항목명 또는 비용 중 하나만 있으면 되는 검증이라, 콜 상세 저장(saveCallDetail)의
        // "여러 필드 중 하나만 있으면 통과" 패턴과 동일하게 둘 다 강조하고 첫 필드로 포커스한다.
        markFieldError('maintRecordName');
        markFieldError('maintRecordFare');
        document.getElementById('maintRecordName').focus();
        return;
    }

    const newItem = {
        name: name,
        fare: fare,
        mileage: mileage,
        category: category,
        payment: payment
    };

    if (!document.getElementById('workModal').classList.contains('hidden')) {
        const tempItems = isMisc ? currentTempMiscItems : currentTempMaintItems;
        if (origIndex !== '') {
            tempItems[origIndex] = newItem;
        } else {
            tempItems.push(newItem);
        }
        if (isMisc) renderMiscSummaryInMainModal(); else renderMaintSummaryInMainModal();
        autoSaveWorkRecord();
    } else {
        if (origDate && origIndex !== '') {
            workData[origDate][dataKey].splice(parseInt(origIndex, 10), 1);
        }

        if (!workData[date]) {
            workData[date] = { isOff: false, fixedCount: 0, palletCount: 0, maintItems: [], fuelItems: [], miscItems: [], callDetails: [] };
        }
        if (!workData[date][dataKey]) {
            workData[date][dataKey] = [];
        }

        workData[date][dataKey].push(newItem);

        saveDataToStorage();

        const updatedDate = new Date(date);
        viewDateRef.setFullYear(updatedDate.getFullYear());
        viewDateRef.setMonth(updatedDate.getMonth());
        if (isMisc) {
            updateMiscDateSelects();
            renderMiscList();
        } else {
            updateMaintDateSelects();
            renderMaintList();
        }
        buildCalendar();
    }

    closeMaintRecordModal();
    showToastMessage('저장되었습니다.');
}

function deleteMaintRecord(date, index, kind = 'maint') {
    const dataKey = kind === 'misc' ? 'miscItems' : 'maintItems';
    showConfirmModal('삭제하시겠습니까?', () => {
        workData[date][dataKey].splice(index, 1);
        saveDataToStorage();
        if (kind === 'misc') renderMiscList(); else renderMaintList();
        showToastMessage('삭제되었습니다.');
        buildCalendar();
    });
}

function deleteMiscRecord(date, index) {
    deleteMaintRecord(date, index, 'misc');
}

// ========== 정비/주유/기타 관리 목록 로직 ==========
const MAINT_FUEL_KIND_CONFIG = {
    maint: {
        containerId: 'maintListContainer',
        dataKey: 'maintItems',
        label: '정비',
        recordClass: 'maint-record',
        dayClass: 'maint-day',
        amount: item => parseCurrencyValue(item.fare),
        title: item => escapeDetailText(item.name || '정비'),
        notes: item => [item.payment || '카드', item.category, item.mileage ? `누적 ${item.mileage}km` : ''],
        icon: () => '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>',
        editAction: (date, idx) => `openMaintRecordModal('${date}', ${idx})`,
        deleteAction: (date, idx) => `deleteMaintRecord('${date}', ${idx})`
    },
    fuel: {
        containerId: 'fuelListContainer',
        dataKey: 'fuelItems',
        label: '주유',
        recordClass: 'fuel-record',
        dayClass: 'fuel-day',
        amount: item => parseCurrencyValue(item.cost),
        title: item => `${escapeDetailText(item.type || '주유')}${item.liter ? ` (${escapeDetailText(item.liter)}L)` : ''}`,
        notes: item => [item.mileage ? `누적 ${item.mileage}km` : '', item.subsidy ? `보조금 ${parseCurrencyValue(item.subsidy).toLocaleString()}원` : ''],
        icon: () => fuelIconSvg(),
        editAction: (date, idx) => `openFuelDetailModal('${date}', ${idx})`,
        deleteAction: (date, idx) => `deleteFuelRecord('${date}', ${idx})`
    },
    misc: {
        containerId: 'miscListContainer',
        dataKey: 'miscItems',
        label: '기타',
        recordClass: 'misc-record',
        dayClass: 'misc-day',
        amount: item => parseCurrencyValue(item.fare),
        title: item => escapeDetailText(item.name || item.category || '기타'),
        notes: item => [item.payment || '카드', item.category],
        icon: () => '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"></path></svg>',
        editAction: (date, idx) => `openMiscRecordModal('${date}', ${idx})`,
        deleteAction: (date, idx) => `deleteMiscRecord('${date}', ${idx})`
    }
};

function getMaintFuelViewDate(kind) {
    if (kind === 'fuel') return fuelViewDate;
    if (kind === 'misc') return miscViewDate;
    return maintViewDate;
}

function renderMaintList() {
    renderMaintFuelManagementList('maint');
}

function renderFuelList() {
    renderMaintFuelManagementList('fuel');
}

function renderMiscList() {
    renderMaintFuelManagementList('misc');
}

function renderMaintFuelManagementList(kind) {
    const config = MAINT_FUEL_KIND_CONFIG[kind] || MAINT_FUEL_KIND_CONFIG.maint;
    const targetDate = getMaintFuelViewDate(kind);
    const year = targetDate.getFullYear();
    const monthNumber = targetDate.getMonth() + 1;
    const month = String(monthNumber).padStart(2, '0');
    const prefix = `${year}-${month}-`;
    const container = document.getElementById(config.containerId);
    if (!container) return;
    const grouped = [];
    let monthlyTotal = 0;

    Object.keys(workData).filter(date => date.startsWith(prefix)).sort().forEach(date => {
        const source = workData[date][config.dataKey];
        if (!source?.length) return;
        const items = source.map((item, index) => ({ ...item, index }));
        const dailyTotal = items.reduce((sum, item) => sum + config.amount(item), 0);
        monthlyTotal += dailyTotal;
        grouped.push({ date, items, dailyTotal });
    });

    if (grouped.length === 0) {
        container.innerHTML = `<div class="empty-state">이번 달 등록된 ${config.label} 내역이 없습니다.</div>`;
    } else {
        container.innerHTML = grouped.map(group => {
            const itemHtml = group.items.map(item => {
                const amount = config.amount(item);
                const title = config.title(item);
                const notes = config.notes(item).filter(Boolean).map(value => `<span>${escapeDetailText(value)}</span>`).join('');
                const icon = config.icon();
                const editAction = config.editAction(group.date, item.index);
                const deleteAction = config.deleteAction(group.date, item.index);
                return `<div class="management-record-item ${config.recordClass}">
                    <div class="management-record-head"><div class="management-record-title">${icon}<strong>${title}</strong></div><div class="management-record-actions"><button type="button" class="action-icon-btn" onclick="${editAction}" title="수정">${editDetailSvg()}</button><button type="button" class="action-icon-btn del" onclick="${deleteAction}" title="삭제">${deleteDetailSvg()}</button></div></div>
                    <div class="management-record-info"><div>${notes}</div><strong>${amount.toLocaleString()}원</strong></div>
                </div>`;
            }).join('');
            return `<section class="management-day-card ${config.dayClass}">
                <div class="management-day-head"><strong>${group.date}</strong><div><span>${config.label} 합계</span><b>${group.dailyTotal.toLocaleString()}원</b></div></div>
                <div class="management-day-items">${itemHtml}</div>
            </section>`;
        }).join('');
    }

    const label = document.getElementById('maintFuelMonthLabel');
    const total = document.getElementById('maintFuelMonthTotal');
    if (label) {
        label.textContent = `${monthNumber}월 ${config.label}`;
        label.classList.toggle('fuel-color', kind === 'fuel');
        label.classList.toggle('misc-color', kind === 'misc');
    }
    if (total) total.textContent = `${monthlyTotal.toLocaleString()}원`;
}

function openMaintFuelCurrentAdd() {
    if (document.getElementById('maintTabPanel').style.display !== 'none') openMaintRecordModal();
    else if (document.getElementById('fuelTabPanel').style.display !== 'none') openFuelDetailModal();
    else openMiscRecordModal();
}

function openMaintFuelSelectModal() {
    const selectModal = document.getElementById('maintFuelSelectModal');
    const isFromWorkModal = !document.getElementById('workModal').classList.contains('hidden');
    if (!isFromWorkModal) restoreMaintFuelModalToRoot(selectModal);
    selectModal.classList.remove('hidden');
    if (isFromWorkModal) {
        openMaintFuelInlinePanel(selectModal);
    }
}

function closeMaintFuelSelectModal() {
    closeMaintFuelInlinePanel(document.getElementById('maintFuelSelectModal'));
}

function selectMaintOption() {
    hideMaintFuelInlinePanelImmediately(document.getElementById('maintFuelSelectModal'));
    openMaintRecordModal();
}

function selectFuelOption() {
    hideMaintFuelInlinePanelImmediately(document.getElementById('maintFuelSelectModal'));
    openFuelDetailModal(selectedDateKey);
}

function selectMiscOption() {
    hideMaintFuelInlinePanelImmediately(document.getElementById('maintFuelSelectModal'));
    openMiscRecordModal(selectedDateKey);
}

function openMaintFuelInlinePanel(panel) {
    const host = document.getElementById('maintFuelInlineHost');
    if (!host || !panel) return;

    ['maintFuelSelectModal', 'maintRecordModal', 'fuelDetailModal'].forEach(id => {
        const other = document.getElementById(id);
        if (other && other !== panel) {
            other.classList.add('hidden');
            other.classList.remove('inline-expanded', 'is-visible');
        }
    });

    host.appendChild(panel);
    panel.classList.remove('hidden');
    panel.classList.add('inline-expanded');
    host.classList.add('is-open');
    host.setAttribute('aria-hidden', 'false');
    host.style.maxHeight = '0px';

    requestAnimationFrame(() => {
        panel.classList.add('is-visible');
        host.style.maxHeight = `${panel.scrollHeight}px`;
        setTimeout(() => {
            host.style.maxHeight = `${panel.scrollHeight}px`;
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 80);
    });
}

function hideMaintFuelInlinePanelImmediately(panel) {
    const host = document.getElementById('maintFuelInlineHost');
    if (!panel || !panel.classList.contains('inline-expanded')) return;
    panel.classList.add('hidden');
    panel.classList.remove('inline-expanded', 'is-visible');
    if (host) host.style.maxHeight = '0px';
}

function closeMaintFuelInlinePanel(panel) {
    const host = document.getElementById('maintFuelInlineHost');
    if (!panel || !host || !panel.classList.contains('inline-expanded')) {
        panel?.classList.add('hidden');
        return;
    }

    panel.classList.remove('is-visible');
    host.style.maxHeight = '0px';
    host.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
        panel.classList.add('hidden');
        panel.classList.remove('inline-expanded');
        host.classList.remove('is-open');
    }, 420);
}

function openFuelDetailModal(date = null, index = null) {
    let isFromWorkModal = !document.getElementById('workModal').classList.contains('hidden');
    const fuelModal = document.getElementById('fuelDetailModal');

    if (!isFromWorkModal) restoreMaintFuelModalToRoot(fuelModal);

    if (isFromWorkModal && index === null && fuelModal.classList.contains('inline-expanded') && !fuelModal.classList.contains('hidden')) {
        closeMaintFuelInlinePanel(fuelModal);
        return;
    }
    
    let targetDate = date;
    if (!date) {
        const y = fuelViewDate.getFullYear();
        const m = String(fuelViewDate.getMonth() + 1).padStart(2, '0');
        const d = String(new Date().getDate()).padStart(2, '0');
        targetDate = `${y}-${m}-${d}`;
    }

    document.getElementById('fuelDetailDate').value = targetDate;
    document.getElementById('fuelOriginalDate').value = date || '';
    document.getElementById('fuelOriginalIndex').value = index !== null ? index : '';

    document.getElementById('fuelDetailCost').value = '';
    document.getElementById('fuelDetailSubsidy').value = '';
    document.getElementById('fuelDetailLiter').value = '';
    document.getElementById('fuelDetailMileage').value = '';
    selectFuelType(document.querySelector('#fuelTypeGroup .pill-btn'), '주유', false);

    if (isFromWorkModal && index !== null && currentTempFuelItems[index]) {
        const item = currentTempFuelItems[index];
        if (item) {
            document.getElementById('fuelDetailCost').value = item.cost || '';
            document.getElementById('fuelDetailSubsidy').value = item.subsidy || '';
            document.getElementById('fuelDetailLiter').value = item.liter || '';
            document.getElementById('fuelDetailMileage').value = item.mileage || '';
            const btns = document.querySelectorAll('#fuelTypeGroup .pill-btn');
            const targetBtn = Array.from(btns).find(b => b.textContent === item.type);
            selectFuelType(targetBtn || btns[0], item.type || '주유', false);
        }
    } else if (date && index !== null) {
        const item = workData[date]?.fuelItems[index];
        document.getElementById('fuelDetailCost').value = item.cost || '';
        document.getElementById('fuelDetailSubsidy').value = item.subsidy || '';
        document.getElementById('fuelDetailLiter').value = item.liter || '';
        document.getElementById('fuelDetailMileage').value = item.mileage || '';
        const btns = document.querySelectorAll('#fuelTypeGroup .pill-btn');
        const targetBtn = Array.from(btns).find(b => b.textContent === item.type);
        selectFuelType(targetBtn || btns[0], item.type || '주유', false);
    }

    fuelModal.classList.remove('hidden');
    if (isFromWorkModal) openMaintFuelInlinePanel(fuelModal);
}

function closeFuelDetailModal() {
    closeMaintFuelInlinePanel(document.getElementById('fuelDetailModal'));
}

function selectFuelType(btnEl, type, allowToggle = true) {
    const isAlreadySelected = allowToggle && !!btnEl?.classList.contains('active');
    document.querySelectorAll('#fuelTypeGroup .pill-btn').forEach(btn => btn.classList.remove('active'));
    if (btnEl && !isAlreadySelected) btnEl.classList.add('active');
    document.getElementById('fuelDetailType').value = isAlreadySelected ? '' : type;
}

function saveFuelDetail() {
    const date = document.getElementById('fuelDetailDate').value;
    const cost = document.getElementById('fuelDetailCost').value.trim();
    const subsidy = document.getElementById('fuelDetailSubsidy').value.trim();
    const type = document.getElementById('fuelDetailType').value;
    const liter = document.getElementById('fuelDetailLiter').value.trim();
    const mileage = document.getElementById('fuelDetailMileage').value.trim();
    
    const origDate = document.getElementById('fuelOriginalDate').value;
    const origIndex = document.getElementById('fuelOriginalIndex').value;

    if (!date) {
        markFieldError('fuelDetailDate');
        document.getElementById('fuelDetailDate').focus();
        return;
    }
    if (!cost && !liter) {
        // 비용 또는 주유량 중 하나만 있으면 되는 검증이라, 콜 상세 저장(saveCallDetail)의
        // "여러 필드 중 하나만 있으면 통과" 패턴과 동일하게 둘 다 강조하고 첫 필드로 포커스한다.
        markFieldError('fuelDetailCost');
        markFieldError('fuelDetailLiter');
        document.getElementById('fuelDetailCost').focus();
        return;
    }

    const newItem = { date, cost, subsidy, type, liter, mileage };

    if (!document.getElementById('workModal').classList.contains('hidden')) {
        if (origIndex !== '') {
            currentTempFuelItems[origIndex] = newItem;
        } else {
            currentTempFuelItems.push(newItem);
        }
        renderFuelSummaryInMainModal();
        autoSaveWorkRecord();
    } else {
        if (origDate && origIndex !== '') {
            workData[origDate].fuelItems.splice(parseInt(origIndex, 10), 1);
        }

        if (!workData[date]) {
            workData[date] = { isOff: false, fixedCount: 0, palletCount: 0, maintItems: [], fuelItems: [], callDetails: [] };
        }
        if (!workData[date].fuelItems) {
            workData[date].fuelItems = [];
        }
        
        workData[date].fuelItems.push(newItem);
        saveDataToStorage();
        
        const updatedDate = new Date(date);
        fuelViewDate.setFullYear(updatedDate.getFullYear());
        fuelViewDate.setMonth(updatedDate.getMonth());
        updateFuelDateSelects();
        renderFuelList();
        buildCalendar();
    }

    showToastMessage('저장되었습니다.');
    closeFuelDetailModal();
}

function deleteFuelRecord(date, index) {
    showConfirmModal('삭제하시겠습니까?', () => {
        workData[date].fuelItems.splice(index, 1);
        saveDataToStorage(); 
        renderFuelList();
        showToastMessage('삭제되었습니다.');
        buildCalendar();
    });
}

function renderMaintSummaryInMainModal() {
    const container = document.getElementById('maintSummaryContainer');
    const listCard = document.getElementById('maintSummaryList');
    if (!container || !listCard) return;
    if (currentTempMaintItems.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    let total = 0;
    const items = currentTempMaintItems.map((item, idx) => {
        const amount = parseCurrencyValue(item.fare);
        total += amount;
        const detail = [item.category, item.mileage ? `누적 ${item.mileage}km` : ''].filter(Boolean).map(escapeDetailText).join(' · ');
        return `<div class="maint-fuel-item maint-item-card">
            <div class="maint-fuel-head">
                <div class="maint-fuel-title maint-title-color"><svg class="maint-fuel-icon" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg><strong>${escapeDetailText(item.name || '정비')}</strong></div>
                <div class="maint-fuel-actions"><button type="button" class="action-icon-btn" onclick="openMaintRecordModal('${selectedDateKey}', ${idx})" title="수정">${editDetailSvg()}</button><button type="button" class="action-icon-btn del" onclick="currentTempMaintItems.splice(${idx}, 1); renderMaintSummaryInMainModal(); autoSaveWorkRecord();" title="삭제">${deleteDetailSvg()}</button></div>
            </div>
            <div class="maint-fuel-info"><div><span class="maint-payment-badge">${escapeDetailText(item.payment || '카드')}</span>${detail ? `<span class="maint-fuel-note">${detail}</span>` : ''}</div><strong>${amount.toLocaleString()}원</strong></div>
        </div>`;
    }).join('');
    listCard.innerHTML = `${items}<div class="maint-fuel-total maint-total-color"><strong>정비 합계</strong><strong>${total.toLocaleString()}원</strong></div>`;
}

function renderFuelSummaryInMainModal() {
    const container = document.getElementById('fuelSummaryContainer');
    const listCard = document.getElementById('fuelSummaryList');
    if (!container || !listCard) return;
    if (currentTempFuelItems.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    let total = 0;
    const items = currentTempFuelItems.map((item, idx) => {
        const amount = parseCurrencyValue(item.cost);
        total += amount;
        const note = [item.mileage ? `누적 ${item.mileage}km` : '', item.subsidy ? `보조금 ${parseCurrencyValue(item.subsidy).toLocaleString()}원` : ''].filter(Boolean).join(' · ');
        return `<div class="maint-fuel-item fuel-item-card">
            <div class="maint-fuel-head">
                <div class="maint-fuel-title fuel-title-color">${fuelIconSvg('maint-fuel-icon')}<strong>${escapeDetailText(item.type || '주유')}${item.liter ? ` (${escapeDetailText(item.liter)}L)` : ''}</strong></div>
                <div class="maint-fuel-actions"><button type="button" class="action-icon-btn" onclick="openFuelDetailModal('${selectedDateKey}', ${idx})" title="수정">${editDetailSvg()}</button><button type="button" class="action-icon-btn del" onclick="currentTempFuelItems.splice(${idx}, 1); renderFuelSummaryInMainModal(); autoSaveWorkRecord();" title="삭제">${deleteDetailSvg()}</button></div>
            </div>
            <div class="maint-fuel-info"><div>${note ? `<span class="maint-fuel-note">${escapeDetailText(note)}</span>` : ''}</div><strong>${amount.toLocaleString()}원</strong></div>
        </div>`;
    }).join('');
    listCard.innerHTML = `${items}<div class="maint-fuel-total fuel-total-color"><strong>주유 합계</strong><strong>${total.toLocaleString()}원</strong></div>`;
}

function renderMiscSummaryInMainModal() {
    const container = document.getElementById('miscSummaryContainer');
    const listCard = document.getElementById('miscSummaryList');
    if (!container || !listCard) return;
    if (currentTempMiscItems.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    let total = 0;
    const items = currentTempMiscItems.map((item, idx) => {
        const amount = parseCurrencyValue(item.fare);
        total += amount;
        const detail = [item.category].filter(Boolean).map(escapeDetailText).join(' · ');
        return `<div class="maint-fuel-item misc-item-card">
            <div class="maint-fuel-head">
                <div class="maint-fuel-title misc-title-color"><svg class="maint-fuel-icon" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"></path></svg><strong>${escapeDetailText(item.name || item.category || '기타')}</strong></div>
                <div class="maint-fuel-actions"><button type="button" class="action-icon-btn" onclick="openMiscRecordModal('${selectedDateKey}', ${idx})" title="수정">${editDetailSvg()}</button><button type="button" class="action-icon-btn del" onclick="currentTempMiscItems.splice(${idx}, 1); renderMiscSummaryInMainModal(); autoSaveWorkRecord();" title="삭제">${deleteDetailSvg()}</button></div>
            </div>
            <div class="maint-fuel-info"><div><span class="maint-payment-badge">${escapeDetailText(item.payment || '카드')}</span>${detail ? `<span class="maint-fuel-note">${detail}</span>` : ''}</div><strong>${amount.toLocaleString()}원</strong></div>
        </div>`;
    }).join('');
    listCard.innerHTML = `${items}<div class="maint-fuel-total misc-total-color"><strong>기타 합계</strong><strong>${total.toLocaleString()}원</strong></div>`;
}

function showSettings(fromPage) {
    if (fromPage) previousPage = fromPage;
    settingsReturnLogId = activeLogId;
    loadSettings();
    hideAllPages();
    document.getElementById('settingsPage').classList.remove('hidden');
    // 설정은 더 이상 하단 네비게이션 항목이 아니라 사이드 메뉴로만 들어오므로, 하단 탭
    // 강조를 전부 지운다(해당 자리는 이제 "월매출" 탭이 차지하고 있어 잘못 강조되면 안 됨).
    setActiveNav('none');
}

function goBackFromSettings() {
    loadSettings();
    if (previousPage === 'report') {
        showReport();
    } else if (previousPage === 'myPage') {
        // 마이페이지의 "앱 설정" 바로가기로 들어온 경우, 뒤로가기는 마이페이지로 돌아가야 한다.
        // 이 분기가 없으면 previousPage가 'main'/'report' 둘 다 아니므로 else 분기(로그
        // 홈으로 복귀)를 타서, 마이페이지에서 들어왔는데 엉뚱하게 달력 화면으로 나가버린다.
        showMyPage(true);
    } else {
        returnToLogHome(settingsReturnLogId);
    }
}

function showReport(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    document.getElementById('sideMenu').classList.remove('open');
    document.getElementById('sideMenuOverlay').classList.remove('show');

    const settings = getUserSettings();
    const cars = settings.cars || [];
    const hasActiveSubLog = cars.some(car => car.type === 'sub' && car.logEnabled);

    if (hasActiveSubLog) {
        openReportCarSelectModal(cars);
    } else {
        executeShowReport('main');
    }
}

function executeShowReport(carNum) {
    if (activeLogId !== carNum) {
        switchCarLog(carNum);
    }
    
    hideAllPages();
    document.getElementById('reportPage').classList.remove('hidden');
    
    const savedSettings = getUserSettings();
    const isMain = activeLogId === 'main';
    const callDetailOn = isMain
        ? (savedSettings.hasOwnProperty('callDetailOn') ? !!savedSettings.callDetailOn : true)
        : (savedSettings.hasOwnProperty('subCallDetailOn') ? !!savedSettings.subCallDetailOn : true);

    if (callDetailOn) {
        document.getElementById('pdfDropdownGroup').style.display = 'block';
        document.getElementById('pdfDownloadBtn').style.display = 'none';
    } else {
        document.getElementById('pdfDropdownGroup').style.display = 'none';
        document.getElementById('pdfDownloadBtn').style.display = 'flex';
    }

    isDetailReportView = false;
    buildReportPage(false); 
}

function handleReportBack() {
    if (isDetailReportView) {
        isDetailReportView = false;
        buildReportPage(false);
    } else {
        goBackFromUtilityPage();
    }
}

function openReportCarSelectModal(cars) {
    const listContainer = document.getElementById('reportCarSelectList');
    listContainer.innerHTML = '';

    cars.forEach(car => {
        if (car.type === 'main' || (car.type === 'sub' && car.logEnabled)) {
            const btn = document.createElement('button');
            btn.className = 'report-car-option';
            const typeLabel = car.type === 'main' ? '메인차량' : '기사차량';
            btn.innerHTML = `<span class="report-car-option-mark" aria-hidden="true"></span><span class="report-car-option-copy"><strong>${typeLabel}</strong><small>${escapeDetailText(car.number)}</small></span><span class="report-car-option-arrow" aria-hidden="true">›</span>`;
            btn.onclick = () => {
                closeReportCarSelectModal();
                executeShowReport(car.type === 'main' ? 'main' : car.number);
            };
            listContainer.appendChild(btn);
        }
    });

    document.getElementById('reportCarSelectModal').classList.remove('hidden');
}

function closeReportCarSelectModal() {
    document.getElementById('reportCarSelectModal').classList.add('hidden');
}

function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
}

function setTheme(theme) {
    const iconContainer = document.getElementById('themeIcon');
    const textContainer = document.getElementById('themeText');
    
    if (theme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        iconContainer.innerHTML = `<svg class="inline-icon sm" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        textContainer.textContent = '다크 모드';
    } else {
        document.body.removeAttribute('data-theme');
        iconContainer.innerHTML = `<svg class="inline-icon sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        textContainer.textContent = '라이트 모드';
    }
}

function toggleFixedSubSettings() {
    const checked = document.getElementById('fixedToggle').checked;
    setSettingsGroupExpanded(document.getElementById('fixedSubSettings'), checked);
}

function toggleSubFixedSettings() {
    const checked = document.getElementById('subFixedToggle').checked;
    const subFixedSection = document.getElementById('subFixedSubSettings');
    setSettingsGroupExpanded(subFixedSection, checked);
}

function setSettingsGroupExpanded(element, expanded, displayMode = 'block') {
    if (!element) return;
    window.clearTimeout(element._settingsCollapseTimer);
    element.classList.add('smooth-settings-group');

    // 숨겨진 페이지/모달을 초기화할 때는 최종 상태만 적용하고,
    // 사용자가 실제로 보고 있는 화면에서 토글할 때만 애니메이션을 실행한다.
    const parentIsVisible = !!element.parentElement?.getClientRects().length;
    if (!parentIsVisible) {
        element.style.display = expanded ? displayMode : 'none';
        element.style.maxHeight = expanded ? 'none' : '0px';
        element.style.opacity = expanded ? '1' : '0';
        element.style.overflow = expanded ? 'visible' : 'hidden';
        return;
    }

    if (expanded) {
        if (element.style.display !== 'none' && element.style.maxHeight === 'none') return;
        element.style.display = displayMode;
        element.style.overflow = 'hidden';
        element.style.maxHeight = '0px';
        element.style.opacity = '0';
        requestAnimationFrame(() => {
            element.style.maxHeight = `${element.scrollHeight}px`;
            element.style.opacity = '1';
        });
        element._settingsCollapseTimer = window.setTimeout(() => {
            if (element.style.display !== 'none') {
                element.style.maxHeight = 'none';
                element.style.overflow = 'visible';
            }
        }, 440);
        return;
    }

    if (element.style.display === 'none') return;
    element.style.overflow = 'hidden';
    element.style.maxHeight = `${element.scrollHeight}px`;
    element.style.opacity = '1';
    requestAnimationFrame(() => {
        element.style.maxHeight = '0px';
        element.style.opacity = '0';
    });
    element._settingsCollapseTimer = window.setTimeout(() => {
        element.style.display = 'none';
    }, 420);
}

function setInputMode(mode, target) {
    if (target === 'main') {
        const btnCount = document.getElementById('btnInputModeCount');
        const btnFare = document.getElementById('btnInputModeFare');
        if (btnCount && btnFare) {
            if (mode === 'count') {
                btnCount.classList.add('active-work');
                btnFare.classList.remove('active-work');
            } else {
                btnFare.classList.add('active-work');
                btnCount.classList.remove('active-work');
            }
        }
    } else {
        const btnSubCount = document.getElementById('btnSubInputModeCount');
        const btnSubFare = document.getElementById('btnSubInputModeFare');
        if (btnSubCount && btnSubFare) {
            if (mode === 'count') {
                btnSubCount.classList.add('active-work');
                btnSubFare.classList.remove('active-work');
            } else {
                btnSubFare.classList.add('active-work');
                btnSubCount.classList.remove('active-work');
            }
        }
    }
}


function normalizeSubRunCountPresetInput() {
    setRunCountPresetChipValues('sub', getRunCountPresetChipValues('sub'));
}

function toggleSubRunCountPresetSettings() {
    const toggle = document.getElementById('subRunCountToggle');
    const setting = document.getElementById('subRunCountPresetSettings');
    setSettingsGroupExpanded(setting, !!toggle?.checked, 'flex');
}

function hideToastMessage() {
    const toast = document.getElementById('toastMessage');
    toast?.classList.remove('show');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = null;
}

function showToastMessage(msg = "저장되었습니다.", options = {}) {
    const toast = document.getElementById('toastMessage');
    if (!toast) return;
    const text = document.getElementById('toastMessageText');
    if (text) text.textContent = msg;
    else toast.textContent = msg;

    toast.classList.add('show');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(hideToastMessage, options.duration || 2000);
}

function saveSettingsSmoothly() {
    queueBackgroundSave('settings', commitSettings, 430);
}

function saveSettings() {
    queueBackgroundSave('settings', commitSettings);
}

function commitSettings() {
    const settings = getUserSettings();
    
    const mainInputModeBtn = document.getElementById('btnInputModeFare');
    if (mainInputModeBtn) {
        settings.inputMode = mainInputModeBtn.classList.contains('active-work') ? 'fare' : 'count';
    }
    
    settings.fixedOn = document.getElementById('fixedToggle').checked;
    // 고정 거래처/단가/파렛트는 거래처 등록 화면으로 옮겨서 여기서는 더 이상 저장하지 않는다
    // (§거래처 등록 개편 — getFixedRouteClient()가 대신 클라이언트 목록에서 찾아온다).
    settings.fixedRouteOn = document.getElementById('fixedRouteToggle') ? document.getElementById('fixedRouteToggle').checked : false;
    settings.runCountToggle = document.getElementById('runCountToggle') ? document.getElementById('runCountToggle').checked : false;
    settings.runCountPresets = getRunCountPresetChipValues('main');
    
    // 조건 항목 저장
    settings.callDetailOn = document.getElementById('callDetailToggle').checked;
    settings.paymentOn = document.getElementById('paymentToggle').checked;
    settings.timeOn = document.getElementById('timeToggle') ? document.getElementById('timeToggle').checked : false;
    settings.platformOn = document.getElementById('platformToggle') ? document.getElementById('platformToggle').checked : false;
    settings.distanceOn = document.getElementById('distanceToggle') ? document.getElementById('distanceToggle').checked : false;
    settings.cargoTonnageOn = document.getElementById('cargoTonnageToggle') ? document.getElementById('cargoTonnageToggle').checked : true;

    if (document.getElementById('subFixedToggle')) {
        const subInputModeBtn = document.getElementById('btnSubInputModeFare');
        if (subInputModeBtn) {
            settings.subInputMode = subInputModeBtn.classList.contains('active-work') ? 'fare' : 'count';
        }

        settings.subFixedOn = document.getElementById('subFixedToggle').checked;
        settings.subFixedRouteOn = document.getElementById('subFixedRouteToggle') ? document.getElementById('subFixedRouteToggle').checked : false;

        // 기사차량 조건 항목 저장
        settings.subCallDetailOn = document.getElementById('subCallDetailToggle').checked;
        settings.subPaymentOn = document.getElementById('subPaymentToggle') ? document.getElementById('subPaymentToggle').checked : false;
        settings.subTimeOn = document.getElementById('subTimeToggle') ? document.getElementById('subTimeToggle').checked : false;
        settings.subPlatformOn = document.getElementById('subPlatformToggle') ? document.getElementById('subPlatformToggle').checked : false;
        settings.subDistanceOn = document.getElementById('subDistanceToggle') ? document.getElementById('subDistanceToggle').checked : false;
        settings.subCargoTonnageOn = document.getElementById('subCargoTonnageToggle') ? document.getElementById('subCargoTonnageToggle').checked : true;
        settings.subRunCountToggle = document.getElementById('subRunCountToggle') ? document.getElementById('subRunCountToggle').checked : false;
        settings.subRunCountPresets = getRunCountPresetChipValues('sub');
    }

    setUserSettings(settings);
    buildCalendar(); 
}

function savePersonalInfo() {
    queueBackgroundSave('personal-info', commitPersonalInfo);
}

function commitPersonalInfo() {
    const settings = getUserSettings();
    settings.bizName = document.getElementById('bizName').value;
    settings.bizRepresentative = document.getElementById('bizRepresentative')?.value || '';
    settings.bizNumber = document.getElementById('bizNumber').value;
    settings.bizAddress = document.getElementById('bizAddress')?.value || '';
    settings.bizType = document.getElementById('bizType')?.value || '';
    settings.bizItem = document.getElementById('bizItem')?.value || '';
    settings.bizEmail = document.getElementById('bizEmail')?.value || '';
    settings.userName = document.getElementById('userName').value;
    settings.userPhone = document.getElementById('userPhone').value;
    settings.bankName = document.getElementById('bankName').value;
    settings.accountNumber = document.getElementById('accountNumber').value;
    settings.accountHolder = document.getElementById('accountHolder')?.value || '';
    setUserSettings(settings);
}

function loadSettings() {
    updateTransportSettingsUI();

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);

    const savedSettings = getUserSettings();
    if (Object.keys(savedSettings).length > 0) {
        if (savedSettings.inputMode === 'fare') {
            setInputMode('fare', 'main');
        } else {
            setInputMode('count', 'main');
        }
        
        document.getElementById('fixedToggle').checked = !!savedSettings.fixedOn;
        // 고정 거래처/단가/파렛트 입력칸은 거래처 등록 화면으로 옮겨서 여기선 더 이상 없다.
        if (document.getElementById('fixedRouteToggle')) document.getElementById('fixedRouteToggle').checked = !!savedSettings.fixedRouteOn;
        renderFixedRoutePresetList('main');
        toggleFixedRoutePresetSettings('main');
        if (document.getElementById('runCountToggle')) document.getElementById('runCountToggle').checked = !!savedSettings.runCountToggle;
        setRunCountPresetChipValues('main', savedSettings.runCountPresets);

        // 세부 입력은 항상 켜져 있는 상태를 기본으로 처리
        document.getElementById('callDetailToggle').checked = savedSettings.hasOwnProperty('callDetailOn') ? !!savedSettings.callDetailOn : true;
        document.getElementById('paymentToggle').checked = !!savedSettings.paymentOn;
        if(document.getElementById('timeToggle')) document.getElementById('timeToggle').checked = !!savedSettings.timeOn;
        if(document.getElementById('platformToggle')) document.getElementById('platformToggle').checked = !!savedSettings.platformOn;
        if(document.getElementById('distanceToggle')) document.getElementById('distanceToggle').checked = !!savedSettings.distanceOn;
        if(document.getElementById('cargoTonnageToggle')) {
            document.getElementById('cargoTonnageToggle').checked = savedSettings.hasOwnProperty('cargoTonnageOn') ? !!savedSettings.cargoTonnageOn : true;
        }

        if (document.getElementById('subFixedToggle')) {
            if (savedSettings.subInputMode === 'fare') {
                setInputMode('fare', 'sub');
            } else {
                setInputMode('count', 'sub');
            }
            
            document.getElementById('subFixedToggle').checked = !!savedSettings.subFixedOn;
            if (document.getElementById('subFixedRouteToggle')) document.getElementById('subFixedRouteToggle').checked = !!savedSettings.subFixedRouteOn;
            renderFixedRoutePresetList('sub');
            toggleFixedRoutePresetSettings('sub');

            document.getElementById('subCallDetailToggle').checked = savedSettings.hasOwnProperty('subCallDetailOn') ? !!savedSettings.subCallDetailOn : true;
            if(document.getElementById('subPaymentToggle')) document.getElementById('subPaymentToggle').checked = !!savedSettings.subPaymentOn;
            if(document.getElementById('subTimeToggle')) document.getElementById('subTimeToggle').checked = !!savedSettings.subTimeOn;
            if(document.getElementById('subPlatformToggle')) document.getElementById('subPlatformToggle').checked = !!savedSettings.subPlatformOn;
            if(document.getElementById('subDistanceToggle')) document.getElementById('subDistanceToggle').checked = !!savedSettings.subDistanceOn;
            if(document.getElementById('subCargoTonnageToggle')) document.getElementById('subCargoTonnageToggle').checked = savedSettings.hasOwnProperty('subCargoTonnageOn') ? !!savedSettings.subCargoTonnageOn : true;
            if(document.getElementById('subRunCountToggle')) document.getElementById('subRunCountToggle').checked = !!savedSettings.subRunCountToggle;
            setRunCountPresetChipValues('sub', savedSettings.subRunCountPresets);
            
            toggleSubFixedSettings();
            toggleSubRunCountPresetSettings();
            updateToggleDependencies('sub');
        }

        if(document.getElementById('bizName')) document.getElementById('bizName').value = savedSettings.bizName || '';
        if(document.getElementById('bizRepresentative')) document.getElementById('bizRepresentative').value = savedSettings.bizRepresentative || '';
        if(document.getElementById('bizNumber')) document.getElementById('bizNumber').value = savedSettings.bizNumber || '';
        if(document.getElementById('bizAddress')) document.getElementById('bizAddress').value = savedSettings.bizAddress || '';
        if(document.getElementById('bizType')) document.getElementById('bizType').value = savedSettings.bizType || '';
        if(document.getElementById('bizItem')) document.getElementById('bizItem').value = savedSettings.bizItem || '';
        if(document.getElementById('bizEmail')) document.getElementById('bizEmail').value = savedSettings.bizEmail || '';
        document.getElementById('userName').value = savedSettings.userName || '';
        document.getElementById('userPhone').value = savedSettings.userPhone || '';
        document.getElementById('bankName').value = savedSettings.bankName || '';
        document.getElementById('accountNumber').value = savedSettings.accountNumber || '';
        if(document.getElementById('accountHolder')) document.getElementById('accountHolder').value = savedSettings.accountHolder || '';

        toggleFixedSubSettings();
        toggleRunCountPresetSettings();
        updateToggleDependencies('main');
    }
    updateAccountRoleUI();
    applySettingsHydrationLock();
}

// 로그인 직후 하이드레이션(서버 → 로컬 동기화)이 아직 끝나지 않았을 때(supabaseHydrationCompleted
// === false) 앱 설정 화면에 들어와 값을 바꾸면, 그 직후 하이드레이션이 로컬 값을 서버 값으로
// 덮어써서 방금 바꾼 게 사라진 것처럼 보일 수 있다(실제 데이터 유실 자체는 하이드레이션이
// 끝나는 시점에 다시 서버로 밀어 올리도록 이미 막아뒀지만, 이 짧은 구간 동안은 화면이 혼란
// 스러울 수 있다). 그래서 이 구간에는 입력 자체를 잠그고 안내 문구를 보여준다. loadSettings()가
// 화면 진입 시/하이드레이션 완료 시 양쪽에서 다 호출되므로 여기 한 곳에서만 처리하면 된다.
function applySettingsHydrationLock() {
    const page = document.getElementById('settingsPage');
    const notice = document.getElementById('settingsHydrationLockNotice');
    if (!page) return;
    const locked = typeof supabaseHydrationCompleted !== 'undefined' && !supabaseHydrationCompleted;
    notice?.classList.toggle('hidden', !locked);

    page.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = locked; });
    page.querySelectorAll('.settings-segmented-control .toggle-btn').forEach(el => { el.disabled = locked; });

    // updateToggleDependencies()처럼 이 화면 안에 이미 있는 업무 로직이 일부 필드를 의도적으로
    // disabled 처리해 두는 경우가 있다(예: 고정노선 OFF일 때 세부입력 토글은 항상 강제로
    // 켜지고 비활성화된다). 잠금을 풀 때 무조건 전부 enable하면 그 규칙이 깨지므로, 스냅샷을
    // 저장했다 복원하는 대신 그 로직을 다시 실행해 "지금 값 기준"으로 다시 계산한다 — 잠겨
    // 있던 사이에 하이드레이션으로 값 자체가 바뀌었을 수도 있어서, 예전 상태를 그대로 복원하는
    // 것보다 이 편이 더 정확하다.
    if (!locked && typeof updateToggleDependencies === 'function') {
        updateToggleDependencies('main');
        if (document.getElementById('subFixedToggle')) updateToggleDependencies('sub');
    }
}

// 스위치 간의 종속성을 관리하는 새로운 함수 (하단에 추가)
function updateToggleDependencies(type) {
    if (type === 'main') {
        const fixedToggle = document.getElementById('fixedToggle');
        const callDetailToggle = document.getElementById('callDetailToggle');
        const callDetailSubSettings = document.getElementById('callDetailSubSettings');
        const callDetailDependencyHint = document.getElementById('callDetailDependencyHint');

        const paymentToggle = document.getElementById('paymentToggle');
        const timeToggle = document.getElementById('timeToggle');
        const platformToggle = document.getElementById('platformToggle');
        const distanceToggle = document.getElementById('distanceToggle');

        if (!fixedToggle || !callDetailToggle) return;

        // 조건 2: 고정노선 OFF 시 세부입력 ON 강제 및 disabled 처리
        if (!fixedToggle.checked) {
            callDetailToggle.checked = true;
            callDetailToggle.disabled = true;
        } else {
            callDetailToggle.disabled = false;
        }
        if (callDetailDependencyHint) {
            callDetailDependencyHint.hidden = fixedToggle.checked;
        }

        // 조건 1: 운행 일지 세부 입력 토글 상태에 따른 하위 그룹 표시/숨김
        if (callDetailSubSettings) {
            if (!callDetailToggle.checked) {
                setSettingsGroupExpanded(callDetailSubSettings, false);
                if(paymentToggle) paymentToggle.checked = false;
                if(timeToggle) timeToggle.checked = false;
                if(platformToggle) platformToggle.checked = false;
                if(distanceToggle) distanceToggle.checked = false;
            } else {
                setSettingsGroupExpanded(callDetailSubSettings, true);
            }
        }
    } else {
        const subFixedToggle = document.getElementById('subFixedToggle');
        const subCallDetailToggle = document.getElementById('subCallDetailToggle');
        const subCallDetailSubSettings = document.getElementById('subCallDetailSubSettings');
        const subCallDetailDependencyHint = document.getElementById('subCallDetailDependencyHint');
        const subDetailToggles = [
            'subPaymentToggle',
            'subTimeToggle',
            'subPlatformToggle',
            'subDistanceToggle',
            'subCargoTonnageToggle'
        ].map(id => document.getElementById(id));

        if (!subFixedToggle || !subCallDetailToggle) return;

        if (!subFixedToggle.checked) {
            subCallDetailToggle.checked = true;
            subCallDetailToggle.disabled = true;
        } else {
            subCallDetailToggle.disabled = false;
        }
        if (subCallDetailDependencyHint) {
            subCallDetailDependencyHint.hidden = subFixedToggle.checked;
        }

        if (subCallDetailSubSettings) {
            if (!subCallDetailToggle.checked) {
                setSettingsGroupExpanded(subCallDetailSubSettings, false);
                subDetailToggles.forEach(toggle => {
                    if (toggle) toggle.checked = false;
                });
            } else {
                setSettingsGroupExpanded(subCallDetailSubSettings, true);
            }
        }
    }
}

const APP_BACKUP_TYPE = 'plaintext-transport-log';
const APP_BACKUP_VERSION = 3;
const APP_BACKUP_JSON_KEYS = new Set([
    'userSettings',
    'workData',
    'taxInvoiceRecords',
    'messageTemplateCustomBodies',
    'supportInquiries',
    'normalizedSchemaMeta',
    'entityUsers',
    'entityVehicles',
    'entityDailyLogs',
    'entityTransportDetails',
    'entityMaintenanceRecords',
    'entityFuelRecords',
    'entityClients',
    'entityTaxInvoices'
]);
const APP_BACKUP_TEXT_KEYS = new Set(['theme', 'reportShareMessagePattern', 'normalizedUserId']);

function isBackupRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAppBackupStorageKey(key) {
    return APP_BACKUP_JSON_KEYS.has(key)
        || APP_BACKUP_TEXT_KEYS.has(key)
        || key.startsWith('workData_')
        || key.startsWith('linkedDriverWorkData_');
}

// 계정을 바꿔가며 로그인할 때(A 계정 로그아웃 → 같은 기기에서 B 계정으로 로그인) A 계정의
// 로컬 캐시(운행일지/차량/거래처 등)가 그대로 남아있으면, initSettingsFromSupabase/
// initWorkDataFromSupabase의 "서버에 없는 항목은 로컬을 보존" 병합 로직 때문에 A 계정 데이터가
// B 계정 데이터에 섞여 들어간다(실제로 보고됨: "1번 계정 정보가 2번 계정으로 덧씌워짐").
// 로그아웃이 로컬 기록을 일부러 안 지우는 것(오프라인 상태에서도 같은 계정으로 다시 들어올 수
// 있게 하려는 의도, 로그아웃 확인창에도 "기기에 저장된 기록은 유지됩니다"라고 명시) 자체는
// 맞는 설계라, 로그아웃 시점이 아니라 "하이드레이션 시점에 로그인한 계정이 마지막으로 이
// 기기를 쓴 계정과 다를 때만" 지운다 — 그래야 같은 계정 재로그인은 그대로 보존되고, 다른
// 계정으로 전환할 때만 안전하게 초기화된다. theme(기기 화면 설정)은 계정과 무관하므로 지우지
// 않는다.
function clearAccountScopedLocalCache() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key !== 'theme' && isAppBackupStorageKey(key)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('supabaseMigrationDone');

    // localStorage뿐 아니라, 로그인 상태에서만 쓰는 "메모리 안" 캐시도 있다. 로그아웃/재로그인은
    // 페이지를 새로고침하지 않으므로(SPA), 이런 모듈 전역 변수는 계정을 바꿔도 저절로 안
    // 비워진다. __supabaseWorkDataSyncedSnapshot(운행기록 동기화 diff 기준점)이 이전 계정
    // 값을 그대로 들고 있으면, 새 계정에서 우연히 같은 날짜 키를 쓸 때 "이미 서버와 동일함"으로
    // 잘못 판단해 실제로 새 계정 몫으로 올려야 할 기록이 누락될 수 있다.
    if (typeof __supabaseWorkDataSyncedSnapshot === 'object' && __supabaseWorkDataSyncedSnapshot) {
        Object.keys(__supabaseWorkDataSyncedSnapshot).forEach(key => delete __supabaseWorkDataSyncedSnapshot[key]);
    }
}

// hydrateFromSupabaseAndMigrate()가 로그인 직후 호출한다. "이 기기가 마지막으로 하이드레이션한
// 계정"과 지금 로그인한 계정이 다르면 위 초기화를 실행하고, 같으면 아무 것도 하지 않는다.
function clearAccountScopedLocalCacheIfAccountChanged(currentUserId) {
    if (!currentUserId) return;
    const lastUserId = localStorage.getItem('lastHydratedSupabaseUserId');
    if (lastUserId && lastUserId !== currentUserId) {
        clearAccountScopedLocalCache();
    }
    localStorage.setItem('lastHydratedSupabaseUserId', currentUserId);
}

function readBackupJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
        console.warn(`${key} 백업 데이터 읽기 실패:`, error);
        return fallback;
    }
}

const BACKUP_REMINDER_DAYS = 14;
// Supabase 로그인 상태(=클라우드에 이미 실시간으로 백업되고 있는 상태)에서는 로컬 백업을
// 훨씬 덜 급하게 재촉해도 된다. 배너 자체가 뜨는 기준일 뿐, 로그인 상태에서는 "overdue"
// 빨간 강조는 아예 쓰지 않는다(아래 renderBackupStatus/checkBackupReminder 참고).
const BACKUP_REMINDER_DAYS_CLOUD_SYNCED = 30;

function getLastBackupDate() {
    const iso = localStorage.getItem('lastBackupAt');
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

// 마지막 백업 이후 지난 일수. 백업한 적이 없으면 null.
function getDaysSinceLastBackup() {
    const lastBackup = getLastBackupDate();
    if (!lastBackup) return null;
    return Math.floor((Date.now() - lastBackup.getTime()) / 86400000);
}

function formatBackupDateText(date) {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function getTodayDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 지금 이 브라우저에서 Supabase에 로그인된 세션이 있는지(=클라우드에 이미 실시간으로
// 백업되고 있는지) 확인한다. supabase-sync.js가 아직 로드되지 않았거나 요청이 실패해도
// 배너/상태 표시 로직 자체가 멈추지 않도록 항상 안전하게 false를 반환한다.
async function isCloudBackupActive() {
    try {
        return typeof getSupabaseUser === 'function' ? !!(await getSupabaseUser()) : false;
    } catch (error) {
        console.error('클라우드 백업 상태 확인 실패:', error);
        return false;
    }
}

// 마이페이지 백업 카드의 "마지막 백업: ..." 상태 텍스트를 갱신한다.
// - Supabase 로그인 상태면 클라우드 자동 백업 중이라는 보조 문구를 덧붙이고, 로컬 백업이
//   좀 늦었다고 해서 위급하게(--sunday-color) 강조하지 않는다.
// - 비로그인 상태면 기존과 동일하게 14일 기준으로 강조한다.
async function renderBackupStatus() {
    const el = document.getElementById('lastBackupStatus');
    if (!el) return;
    const cloudSynced = await isCloudBackupActive();
    const lastBackup = getLastBackupDate();
    const days = getDaysSinceLastBackup();
    const baseText = lastBackup ? `마지막 백업: ${formatBackupDateText(lastBackup)}` : '아직 백업한 적 없음';
    el.textContent = cloudSynced ? `${baseText} · 클라우드 자동 백업 중` : baseText;
    el.classList.toggle('overdue', !cloudSynced && (!lastBackup || days >= BACKUP_REMINDER_DAYS));
}

// 백업 필요 여부를 판단해 알림 패널용 알림 아이템 객체를 반환한다(필요 없으면 null).
// 예전에는 이 판단 결과로 달력 상단 배너를 직접 켜고 껐지만, 이제는 알림 패널의 알림
// 목록/뱃지 카운트에 통합됐다 — updateOverdueNotification()/renderNotificationPanel()이 이
// 함수를 함께 쓴다.
// - 비로그인 상태: 기존과 동일하게 백업한 적이 없거나 BACKUP_REMINDER_DAYS일이 넘게 지났으면 필요.
// - Supabase 로그인 상태(클라우드에 이미 자동 백업 중): 훨씬 느슨한 기준(BACKUP_REMINDER_
//   DAYS_CLOUD_SYNCED)으로만 필요 판정하고, 문구도 안심시키는 톤으로 다르게 쓴다.
// - "오늘 하루 닫기" 대신, 알림 카드를 스와이프로 지우면(dismissNotification) 그 백업
//   시점 기준 키가 dismissedReceivableNotifications에 남아 같은 상태에서는 다시 뜨지 않는다
//   (마지막 백업일이 바뀌면(=새로 백업하면) 키 자체가 달라져 자연스럽게 다시 평가된다).
async function getBackupNotificationItem() {
    const cloudSynced = await isCloudBackupActive();
    const reminderDays = cloudSynced ? BACKUP_REMINDER_DAYS_CLOUD_SYNCED : BACKUP_REMINDER_DAYS;
    const lastBackup = getLastBackupDate();
    const days = getDaysSinceLastBackup();
    const needsBackup = !lastBackup || days >= reminderDays;

    if (!needsBackup) return null;

    const key = `backup_reminder_${lastBackup ? lastBackup.getTime() : 'never'}`;
    const dismissed = getDismissedNotificationKeys();
    if (dismissed.has(key)) return null;

    let message = '';
    if (cloudSynced) {
        message = lastBackup
            ? `로컬 백업으로부터 ${days}일이 지났습니다. 클라우드 자동 저장과 함께 로컬 백업도 보관해 두세요.`
            : '클라우드 자동 저장 중입니다. 만약을 위해 로컬 백업 파일도 함께 보관해 두세요.';
    } else {
        message = lastBackup
            ? `마지막 백업으로부터 ${days}일이 지났습니다. 최신 데이터로 백업해 주세요.`
            : '아직 백업한 적이 없습니다. 브라우저 데이터 삭제 시 기록이 사라질 수 있습니다.';
    }

    return {
        type: 'backup',
        key: key,
        title: '데이터 백업 권장',
        message: message,
        metaText: lastBackup ? `마지막 백업: ${formatBackupDateText(lastBackup)}` : '백업 이력 없음',
        actionLabel: '지금 백업'
    };
}

// 소속 기사인데 아직 차주와 연동되지 않은 경우, 알림 패널에 항상 뜨는 안내 카드다.
// 예전에는 로그인 직후 1회성 토스트로만 안내했는데, 로그인하자마자 1.5초 뒤 잠깐 스쳐가는
// 토스트라 놓치기 쉬웠다 — 연동 전까지는 알림 패널(및 뱃지 카운트)에 계속 남아있게 해서
// 언제든 눌러서 바로 연동 화면으로 갈 수 있게 한다. 백업 알림과 같은 방식으로 스와이프
// 지우기(dismissedReceivableNotifications)도 지원하되, employerLink.status가 실제로
// 'linked'가 되기 전까지는 키가 그대로라 지워도 다음 로그인/새로고침 때 다시 뜬다 — 완전히
// 무시하게 두면 정말 중요한 안내를 놓칠 수 있어서 의도적으로 그렇게 뒀다.
function getEmployerLinkNotificationItem() {
    const settings = getUserSettings();
    if (settings.accountType !== 'employed_driver' || settings.employerLink?.status === 'linked') return null;

    const key = 'employer_link_reminder';
    const dismissed = getDismissedNotificationKeys();
    if (dismissed.has(key)) return null;

    return {
        type: 'employerLink',
        key: key,
        title: '사장님과 연결이 필요해요',
        message: '아직 소속 사장님과 연결되지 않았어요. 초대 코드를 입력하면 차량 정보와 운행 기록이 자동으로 연결돼요.',
        actionLabel: '지금 연결하기'
    };
}

// 저녁까지 오늘자 운행일지를 하나도 안 적었으면 알림 패널에 안내한다. 종이 수첩은 항상
// 옆에 있어서 깜빡할 일이 없는데, 앱은 열어보지 않으면 그냥 잊어버리기 쉽다는 실제 피드백을
// 반영한 것이다. 저녁 시간대(18시 이후)에만 뜨고, 오늘 하루 안에 실제로 뭔가 적으면(콜상세
// 등록, 고정노선 횟수, 휴무 표시 중 하나라도) 바로 사라진다 — 스와이프로 지워도 그건 "오늘"
// 키에만 적용되니 내일은 다시 정상적으로 뜬다.
const TODAY_LOG_REMINDER_HOUR = 18;

function getTodayLogReminderNotificationItem() {
    const now = new Date();
    if (now.getHours() < TODAY_LOG_REMINDER_HOUR) return null;

    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayRecord = readWorkDataStorage('workData')[todayKey];
    const hasEntry = !!todayRecord && (
        !!todayRecord.isOff
        || (Array.isArray(todayRecord.callDetails) && todayRecord.callDetails.length > 0)
        || (parseInt(todayRecord.fixedCount, 10) || 0) > 0
    );
    if (hasEntry) return null;

    const key = `today_log_reminder_${todayKey}`;
    if (getDismissedNotificationKeys().has(key)) return null;

    return {
        type: 'todayLogReminder',
        key,
        title: '오늘 운행 아직 안 적으셨어요',
        message: '잊기 전에 오늘 하루 운행 기록을 남겨 주세요.',
        actionLabel: '오늘 일지 쓰기'
    };
}

// 예전에는 이 함수가 달력 상단 배너를 직접 켜고 껐지만, 이제 백업 알림은 알림 패널로
// 통합됐다 — updateOverdueNotification()을 호출해 뱃지/목록 상태만 다시 계산하면 된다.
function checkBackupReminder() {
    updateOverdueNotification();
}

async function exportData() {
    await flushAllBackgroundSaves();
    const storageData = {};
    const storageKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter(key => key && isAppBackupStorageKey(key));
    storageKeys.forEach(key => {
        storageData[key] = localStorage.getItem(key);
    });

    const subWorkData = {};
    Object.keys(storageData).filter(key => key.startsWith('workData_')).forEach(key => {
        const carNumber = key.slice('workData_'.length);
        try {
            subWorkData[carNumber] = JSON.parse(storageData[key]) || {};
        } catch (error) {
            subWorkData[carNumber] = {};
        }
    });

    const backupData = {
        backupType: APP_BACKUP_TYPE,
        backupVersion: APP_BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        userSettings: getUserSettings(),
        workData: readBackupJsonStorage('workData', {}),
        subWorkData,
        taxInvoiceRecords: readBackupJsonStorage('taxInvoiceRecords', []),
        normalizedEntities: getNormalizedEntitySnapshot(),
        theme: localStorage.getItem('theme') || 'light',
        storageData
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json;charset=utf-8' });
    const fileUrl = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    const todayStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.href = fileUrl;
    downloadAnchor.download = `운송내역_백업_${todayStr}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    showToastMessage('백업 파일을 저장했습니다.');

    // 백업 유도 배너/마이페이지 상태 텍스트가 방금 백업한 결과를 바로 반영하도록 갱신한다.
    localStorage.setItem('lastBackupAt', new Date().toISOString());
    renderBackupStatus();
    checkBackupReminder();
}

function parseBackupStorageJson(key, value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`${key} 데이터가 손상되어 있습니다.`);
    }
}

// 백업 파일의 userSettings 중, "이 기기에 지금 로그인돼 있는 계정이 누구인가"를 나타내는
// 필드는 백업 내용으로 절대 덮어쓰지 않는다 — 백업은 운행기록/거래처/차량단가 같은 업무
// 데이터를 복원하기 위한 것이지, 계정 자체를 바꾸는 수단이 아니다. 실제로 다른 계정(예:
// 차주 A)이 내보낸 백업을 지금 로그인된 다른 계정(예: 소속기사 B)에서 불러오면 B의 이름/
// 전화번호/사업자정보/계좌정보/연동상태까지 A의 것으로 조용히 바뀌는 사고가 있었다.
//
// 여기 나열한 필드는 크게 두 종류로 나뉜다:
// - isLoggedIn/employerLink: 이 기기의 "지금 실제 인증/연결 상태"를 나타내는 값이라, 백업
//   파일의 값으로 절대 대체하지 않는다(백업이 만들어질 당시 다른 계정의 로그인/연동 상태를
//   그대로 가져오면 실제 세션과 어긋나는 상태가 된다 — 특히 employerLink는 다른 차주의
//   vehicleId를 가리켜서, 이후 운행기록이 엉뚱한 차량으로 서버에 올라갈 위험까지 있다).
// - 나머지(이름/연락처/계정유형/사업자정보/계좌정보): 이 기기에 이미 값이 있으면 그 값을
//   우선하고, 이 기기가 아직 아무것도 설정되지 않은 새 상태라면(전부 빈 값) 백업의 값을
//   그대로 채워 넣는다 — 내 백업을 새 기기에 처음 복원하는 정상적인 경우까지 막지 않기
//   위함이다.
const IMPORT_PROTECTED_IDENTITY_FIELDS = [
    'userName', 'userPhone', 'accountType', 'driverType',
    'bizName', 'bizNumber', 'bizAddress', 'bizType', 'bizItem', 'bizEmail',
    'bankName', 'accountNumber', 'accountHolder'
];

function applyCurrentIdentityToImportedSettings(importedSettings) {
    const current = getUserSettings();
    const preserved = { ...importedSettings };
    // isLoggedIn은 반드시 불리언으로 유지한다(백업의 값을 그대로 흡수하면 실제 Supabase
    // 세션과 무관하게 "로그인됨"으로 착각하는 상태가 될 수 있다).
    preserved.isLoggedIn = !!current.isLoggedIn;
    preserved.employerLink = current.employerLink ?? null;
    IMPORT_PROTECTED_IDENTITY_FIELDS.forEach(field => {
        preserved[field] = current[field] || importedSettings[field];
    });
    return preserved;
}

function normalizeImportedBackup(imported) {
    if (!isBackupRecord(imported)) {
        throw new Error('백업 파일의 기본 구조를 확인할 수 없습니다.');
    }
    if (imported.backupType && imported.backupType !== APP_BACKUP_TYPE) {
        throw new Error('이 앱에서 만든 백업 파일이 아닙니다.');
    }

    const storageData = isBackupRecord(imported.storageData) ? imported.storageData : {};
    const storedUserSettings = typeof storageData.userSettings === 'string'
        ? parseBackupStorageJson('사용자 설정', storageData.userSettings)
        : null;
    const storedWorkData = typeof storageData.workData === 'string'
        ? parseBackupStorageJson('메인 운행일지', storageData.workData)
        : null;
    const importedSettings = imported.userSettings ?? storedUserSettings;
    const mainWorkData = imported.workData ?? storedWorkData;
    const subWorkData = imported.subWorkData ?? {};

    if (!isBackupRecord(importedSettings)) {
        throw new Error('사용자 설정 정보가 없는 백업 파일입니다.');
    }
    if (!isBackupRecord(mainWorkData)) {
        throw new Error('메인 운행일지 정보가 없는 백업 파일입니다.');
    }
    if (!isBackupRecord(subWorkData)) {
        throw new Error('기사차량 운행일지 형식이 올바르지 않습니다.');
    }

    const userSettings = applyCurrentIdentityToImportedSettings(importedSettings);

    const storageWrites = {};
    Object.entries(storageData).forEach(([key, value]) => {
        if (!isAppBackupStorageKey(key) || typeof value !== 'string') return;
        if (APP_BACKUP_JSON_KEYS.has(key) || key.startsWith('workData_') || key.startsWith('linkedDriverWorkData_')) {
            parseBackupStorageJson(key, value);
        }
        // normalizedUserId는 이 기기 고유의 로컬 식별자다(getNormalizedUserId 참고) — 이미
        // 값이 있다면 다른 사용자의 백업에 들어있던 값으로 바꿔치기하지 않는다.
        if (key === 'normalizedUserId' && localStorage.getItem('normalizedUserId')) return;
        storageWrites[key] = value;
    });

    storageWrites.userSettings = JSON.stringify(userSettings);
    storageWrites.workData = JSON.stringify(mainWorkData);
    Object.entries(subWorkData).forEach(([carNumber, carWorkData]) => {
        if (!carNumber || !isBackupRecord(carWorkData)) {
            throw new Error('기사차량 운행일지 일부가 손상되어 있습니다.');
        }
        storageWrites[`workData_${carNumber}`] = JSON.stringify(carWorkData);
    });

    if (imported.taxInvoiceRecords !== undefined) {
        if (!Array.isArray(imported.taxInvoiceRecords)) throw new Error('세금계산서 기록 형식이 올바르지 않습니다.');
        storageWrites.taxInvoiceRecords = JSON.stringify(imported.taxInvoiceRecords);
    }
    if (imported.theme === 'light' || imported.theme === 'dark') storageWrites.theme = imported.theme;

    return { userSettings, mainWorkData, subWorkData, storageWrites };
}

function restoreBackupStorage(storageWrites) {
    const previousValues = new Map();
    Object.keys(storageWrites).forEach(key => previousValues.set(key, localStorage.getItem(key)));
    try {
        Object.entries(storageWrites).forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
        previousValues.forEach((value, key) => {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        });
        throw new Error('기기 저장 공간이 부족하거나 데이터 저장이 차단되어 복원하지 못했습니다.');
    }
}

function importData(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.json')) {
        showConfirmModal('앱에서 저장한 JSON 백업 파일을 선택해 주세요. ZIP 파일은 불러올 수 없습니다.', null);
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(String(e.target.result || '').replace(/^\uFEFF/, ''));
            const normalized = normalizeImportedBackup(imported);
            restoreBackupStorage(normalized.storageWrites);

            if (activeLogId === 'main') {
                workData = normalized.mainWorkData;
            } else {
                workData = normalized.subWorkData?.[activeLogId]
                    || readBackupJsonStorage(`workData_${activeLogId}`, {});
            }
            normalizeLegacyData();
            syncNormalizedEntityStore();

            const restoredTheme = localStorage.getItem('theme') || 'light';
            setTheme(restoredTheme);
            loadSettings();
            updateAccountRoleUI();
            buildCalendar();
            renderSubCarMenu();
            renderLinkedDriverList();
            showToastMessage('백업 데이터를 복원했습니다.');

            // restoreBackupStorage()는 localStorage에 직접 쓰기 때문에 이 시점까지는
            // Supabase에 전혀 반영되지 않은 상태다. 로그인 상태라면 지금 반영해두지 않으면
            // 다음 새로고침/재로그인 때 서버의 예전 데이터가 방금 불러온 백업을 덮어써서
            // 조용히 사라진다 — 그래서 반드시 이어서 클라우드에도 실제로 반영한다.
            if (typeof syncImportedBackupToSupabase === 'function') {
                (async () => {
                    try {
                        const user = typeof getSupabaseUser === 'function' ? await getSupabaseUser() : null;
                        if (!user) return;
                        await syncImportedBackupToSupabase();
                        renderLinkedDriverList();
                        showToastMessage('클라우드에도 백업 데이터를 반영했습니다.');
                    } catch (error) {
                        console.error('백업 데이터 클라우드 반영 실패(로컬에는 정상 복원됨):', error);
                        showToastMessage('클라우드 반영 중 오류가 발생했습니다. 로컬에는 정상 복원되어 있습니다.', { duration: 5000 });
                    }
                })();
            }
        } catch (error) {
            console.error('백업 불러오기 실패:', error);
            const message = error instanceof SyntaxError
                ? '파일 내용이 손상되었거나 JSON 백업 파일이 아닙니다.'
                : (error.message || '백업 파일을 복원하지 못했습니다.');
            showConfirmModal(message, null);
        } finally {
            input.value = '';
        }
    };
    reader.onerror = function() {
        showConfirmModal('선택한 백업 파일을 읽지 못했습니다. 파일 권한을 확인해 주세요.', null);
        input.value = '';
    };
    reader.readAsText(file, 'utf-8');
}

function changeMonth(delta) {
    viewDate.setDate(1);
    viewDate.setMonth(viewDate.getMonth() + delta);
    buildCalendar();
}

function buildCalendar() {
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const today = new Date();

    const yearSelect = document.getElementById('yearSelect');
    const monthSelect = document.getElementById('monthSelect');
    if (yearSelect && monthSelect) {
        yearSelect.value = currentYear;
        monthSelect.value = currentMonth;
        yearSelect.parentElement?._dropdownSync?.();
        monthSelect.parentElement?._dropdownSync?.();
    }

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const totalWeeks = Math.ceil((firstDay + lastDate) / 7);
    const totalVisibleCells = totalWeeks * 7;

    let monthTotalWork = 0;
    let monthTotalFare = 0;
    let monthTotalPalletFare = 0;
    let monthTotalMaintFare = 0;
    let monthTotalFuelFare = 0;
    let monthTotalMiscFare = 0;
    let monthTotalCommission = 0;
    let monthTotalDistance = 0; 
    let monthTotalUnpaid = 0; // 미수금 총액 합산 변수 추가

    let fixedBaseFare = 0;
    let defaultBaseFare = 0; 
    let monthFareByClient = {}; 
    let monthCommByClient = {};
    let clientCommLabels = {};

    const savedSettings = getUserSettings();
    const isMain = activeLogId === 'main';
    const activeFixedOn = isMain ? savedSettings.fixedOn : savedSettings.subFixedOn;
    // 고정 거래처/단가/파렛트는 이제 앱설정이 아니라 거래처 등록 화면에서 지정한다(계정
    // 전체에서 "고정노선과 연동" 표시된 거래처 1곳) — 메인/기사차량 구분이 없어졌다.
    const fixedRouteClient = getFixedRouteClient(savedSettings);
    const activePalletOn = !!fixedRouteClient?.palletOn;

    const displayMode = isMain ? (savedSettings.inputMode || 'count') : (savedSettings.subInputMode || 'count');

    const fixedUnitPrice = parseCurrencyValue(fixedRouteClient?.fixedUnitPrice);
    const palletUnitPrice = parseCurrencyValue(fixedRouteClient?.palletPrice);

    for (let i = 0; i < calendarCells.length; i++) {
        const cell = calendarCells[i];
        
        if (i >= totalVisibleCells) {
            cell.style.display = 'none';
        } else {
            cell.style.display = 'flex';
        }

        const dateText = cell.querySelector('.cell-date-text');
        
        // 기존 뱃지 및 점 제거
        const oldBadges = cell.querySelectorAll('.work-badge, .off-badge, .maint-badge, .unpaid-dot');
        oldBadges.forEach(b => b.remove());

        cell.className = 'date-cell';
        cell.removeAttribute('data-date-key');
        cell.removeAttribute('data-month');
        cell.removeAttribute('data-day');
        dateText.textContent = '';

        const dayIndex = i - firstDay + 1;
        if (dayIndex >= 1 && dayIndex <= lastDate) {
            dateText.textContent = dayIndex;

            const dayOfWeek = new Date(currentYear, currentMonth, dayIndex).getDay();
            if (dayOfWeek === 0) cell.classList.add('sunday');
            if (dayOfWeek === 6) cell.classList.add('saturday');

            if (dayIndex === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()) {
                cell.classList.add('today');
            }

            const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayIndex).padStart(2, '0')}`;
            cell.dataset.dateKey = dateKey;
            cell.dataset.month = currentMonth + 1;
            cell.dataset.day = dayIndex;

            const record = workData[dateKey];

            if (record) {
                if (record.isOff) {
                    const badge = document.createElement('span');
                    badge.classList.add('off-badge');
                    badge.textContent = `휴무`;
                    cell.appendChild(badge);
                }

                let dayWorkCount = 0;
                let dayFare = 0;
                let dayPalletFare = 0;
                let dayFixedFare = 0;
                let dayDefaultFare = 0; 
                let hasUnpaidToday = false; // 오늘 하루에 미수 건이 하나라도 있는지 확인

                if (record.fixedCount > 0) {
                    dayWorkCount += parseInt(record.fixedCount, 10);
                    let fAmount = record.fixedCount * fixedUnitPrice;
                    dayFare += fAmount;
                    // 고정 거래처가 지정돼 있으면 "기본 운송료"가 아니라 그 거래처 매출로
                    // 집계한다(고정노선 거래처 연동) — dayFare(당일 총액)는 동일하게 유지되고,
                    // 어느 버킷(기본요금 vs 거래처별)으로 잡히는지만 달라진다.
                    const fixedClientName = fixedRouteClient?.companyName || '';
                    if (fixedClientName) {
                        monthFareByClient[fixedClientName] = (monthFareByClient[fixedClientName] || 0) + fAmount;
                        // 콜상세 거래처와 동일하게, 고정 거래처도 수수료가 켜져 있으면 그대로
                        // 적용한다 — 고정노선이라고 수수료 계산에서 예외를 둘 이유가 없다.
                        const fixedClientObj = fixedRouteClient;
                        if (fixedClientObj?.commEnabled) {
                            let fixedComm = 0;
                            if (fixedClientObj.commType === 'percent' || !fixedClientObj.commType) {
                                fixedComm = Math.floor(fAmount * (parseFloat(fixedClientObj.commValue) / 100));
                                clientCommLabels[fixedClientName] = `${fixedClientObj.commValue}%`;
                            } else {
                                fixedComm = parseCurrencyValue(fixedClientObj.commValue) * Math.max(1, record.fixedCount || 0);
                                clientCommLabels[fixedClientName] = `${parseCurrencyValue(fixedClientObj.commValue).toLocaleString()}원`;
                            }
                            monthCommByClient[fixedClientName] = (monthCommByClient[fixedClientName] || 0) + fixedComm;
                            monthTotalCommission += fixedComm;
                        }
                    } else {
                        dayFixedFare += fAmount;
                    }
                }

                if (record.palletCount > 0 && activeFixedOn && activePalletOn) {
                    dayPalletFare += record.palletCount * palletUnitPrice;
                }

                monthTotalDistance += getRecordTotalDistance(record);

                if (record.callDetails && record.callDetails.length > 0) {
                    record.callDetails.forEach(detail => {
                        let type = detail.distanceType || '';
                        if (type === '공차') {
                            // 0회 처리
                        } else if (type === '혼짐') {
                            if (detail.linkedLoadIndex === 'pending' || detail.linkedLoadIndex === '-1' || detail.linkedLoadIndex === undefined) {
                                dayWorkCount += 1;
                            }
                        } else {
                            dayWorkCount += 1;
                        }

                        let gross = parseCurrencyValue(detail.fare);
                        
                        // 미수금 로직 (결제 기능이 켜져있고, payments 기준으로 완납이 아닐 때 잔액을 합산)
                        if (savedSettings.paymentOn) {
                            const paymentSummary = getDetailPaymentSummary(detail);
                            if (paymentSummary.status !== 'paid') {
                                hasUnpaidToday = true;
                                monthTotalUnpaid += paymentSummary.remainingAmount;
                            }
                        }

                        let comm = 0;
                        let clientName = detail.client ? detail.client.trim() : '';
                        let isRegisteredClient = false;

                        if (clientName) {
                            const clientObj = savedSettings.clients?.find(c => c.companyName === clientName);
                            if (clientObj) {
                                isRegisteredClient = true;
                            }

                            // 수수료 계산은 저장 시점의 스냅샷을 우선 사용한다(거래처명/수수료율이
                            // 나중에 바뀌어도 이미 저장된 기록의 표시값이 소급 변경되지 않도록).
                            // 스냅샷이 없는(마이그레이션 이전) 과거 기록만 현재 거래처 설정을
                            // 참조하는 기존 방식으로 폴백한다.
                            const commSnapshot = detail.commissionSnapshot;
                            const commEnabled = commSnapshot ? commSnapshot.enabled : !!clientObj?.commEnabled;
                            const commType = commSnapshot ? commSnapshot.type : clientObj?.commType;
                            const commValue = commSnapshot ? commSnapshot.value : clientObj?.commValue;

                            if (commEnabled) {
                                if (commType === 'percent' || !commType) {
                                    comm = Math.floor(gross * (parseFloat(commValue) / 100));
                                    clientCommLabels[clientName] = `${commValue}%`;
                                } else {
                                    comm = parseCurrencyValue(commValue);
                                    clientCommLabels[clientName] = `${comm.toLocaleString()}원`;
                                }
                                monthCommByClient[clientName] = (monthCommByClient[clientName] || 0) + comm;
                            }
                        }

                        if (isRegisteredClient) {
                            monthFareByClient[clientName] = (monthFareByClient[clientName] || 0) + gross;
                        } else {
                            dayDefaultFare += gross;
                        }

                        dayFare += gross;
                        monthTotalCommission += comm;
                    });
                }
                
                fixedBaseFare += dayFixedFare;
                defaultBaseFare += dayDefaultFare;

                // 설정의 횟수/금액 표시 방식에 맞춰 홈 달력에는 한 가지만 표시
                if (dayWorkCount > 0 || dayFare > 0 || dayPalletFare > 0) {
                    monthTotalWork += dayWorkCount;
                    monthTotalFare += dayFare;
                    monthTotalPalletFare += dayPalletFare;

                    const badge = document.createElement('span');
                    badge.classList.add('work-badge');

                    if (displayMode === 'fare') {
                        badge.textContent = formatFareShort(dayFare + dayPalletFare);
                    } else {
                        badge.textContent = `${dayWorkCount}회`;
                    }

                    cell.appendChild(badge);
                }

                let dayMaintSum = 0;
                let dayFuelSum = 0;
                let dayMiscSum = 0;

                if (record.maintItems && record.maintItems.length > 0) {
                    dayMaintSum = record.maintItems.reduce((a, b) => a + parseCurrencyValue(b.fare), 0);
                }
                if (record.fuelItems && record.fuelItems.length > 0) {
                    dayFuelSum = record.fuelItems.reduce((a, b) => a + parseCurrencyValue(b.cost), 0);
                }
                if (record.miscItems && record.miscItems.length > 0) {
                    dayMiscSum = record.miscItems.reduce((a, b) => a + parseCurrencyValue(b.fare), 0);
                }

                if (dayMaintSum > 0 || dayFuelSum > 0 || dayMiscSum > 0) {
                    monthTotalMaintFare += dayMaintSum;
                    monthTotalFuelFare += dayFuelSum;
                    monthTotalMiscFare += dayMiscSum;
                    const expBadge = document.createElement('span');
                    expBadge.classList.add('maint-badge');
                    expBadge.textContent = formatFareShort(dayMaintSum + dayFuelSum + dayMiscSum);
                    cell.appendChild(expBadge);
                }

                // 당일에 미수 건이 있을 경우 빨간 점 추가
                if (hasUnpaidToday) {
                    const dot = document.createElement('div');
                    dot.className = 'unpaid-dot';
                    cell.appendChild(dot);
                }
            }
        } else {
            cell.classList.add('empty');
        }
    }

    // 하단 미수금 미니 카드 노출 처리
    const unpaidSummaryCard = document.getElementById('unpaidSummaryCard');
    if (unpaidSummaryCard && savedSettings.paymentOn) {
        if (monthTotalUnpaid > 0) {
            unpaidSummaryCard.style.display = 'flex';
            unpaidSummaryCard.innerHTML = `
                <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round;">
                    <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                이번 달 총 ${monthTotalUnpaid.toLocaleString()}원의 미수금이 있습니다.
            `;
        } else {
            unpaidSummaryCard.style.display = 'none';
        }
    } else if (unpaidSummaryCard) {
        unpaidSummaryCard.style.display = 'none';
    }

    let subCarComm = 0;
    let subCarCommLabel = '기사차량 수수료';
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars?.find(c => c.number === activeLogId);
        if (currentCar?.commEnabled && currentCar.commission) {
            subCarComm = calculateDriverVehicleCommission(currentCar, monthTotalFare + monthTotalPalletFare - monthTotalCommission, monthTotalWork);
            subCarCommLabel = currentCar.commType === 'direct'
                ? `${getShortCarNum(currentCar.number)} 차량 건당 ${parseCurrencyValue(currentCar.commission).toLocaleString()}원`
                : `${getShortCarNum(currentCar.number)} 차량 ${parseFloat(currentCar.commission) || 0}%`;
        }
    }

    const isDistanceOn = activeLogId === 'main' ? !!savedSettings.distanceOn : !!savedSettings.subDistanceOn;
    updateSummary(monthTotalWork, monthTotalFare, monthTotalPalletFare, monthTotalMaintFare, monthTotalFuelFare, monthTotalCommission, subCarComm, subCarCommLabel, fixedBaseFare, defaultBaseFare, monthFareByClient, monthCommByClient, clientCommLabels, monthTotalDistance, isDistanceOn, monthTotalMiscFare);
}

function updateSummary(totalCount, fareTotal, palletTotal, maintTotal, fuelTotal = 0, commissionTotal = 0, subCarComm = 0, subCarCommLabel = '', fixedBaseFare = 0, defaultBaseFare = 0, monthFareByClient = {}, monthCommByClient = {}, clientCommLabels = {}, monthTotalDistance = 0, isDistanceOn = false, miscTotal = 0) {
    document.getElementById('summaryTotalWork').textContent = `총 ${totalCount}회 운행`;
    
    const distanceRow = document.getElementById('summaryDistanceRow');
    const distanceEl = document.getElementById('summaryTotalDistance');
    if (distanceRow && distanceEl) {
        if (isDistanceOn) {
            distanceRow.style.display = 'flex';
            distanceEl.textContent = `${monthTotalDistance} km`;
        } else {
            distanceRow.style.display = 'none';
        }
    }
    
    const baseFareContainer = document.getElementById('dynamicBaseFareContainer');
    if (baseFareContainer) {
        let html = '';
        if (fixedBaseFare > 0) {
            html += `
                <div class="summary-row">
                    <span>고정 기본 운송료</span>
                    <span class="summary-value">${fixedBaseFare.toLocaleString()} 원</span>
                </div>
            `;
        }
        if (defaultBaseFare > 0) {
            html += `
                <div class="summary-row">
                    <span>미지정 거래처 운송료</span>
                    <span class="summary-value">${defaultBaseFare.toLocaleString()} 원</span>
                </div>
            `;
        }
        for (let client in monthFareByClient) {
            html += `
                <div class="summary-row">
                    <span>${escapeDetailText(client)} 기본 운송료</span>
                    <span class="summary-value">${monthFareByClient[client].toLocaleString()} 원</span>
                </div>
            `;
            if (monthCommByClient[client] > 0) {
                html += `
                    <div class="summary-row summary-client-commission-row">
                        <span class="summary-client-commission-label">${escapeDetailText(client)} 수수료 (${clientCommLabels[client]})</span>
                        <span class="summary-value">- ${monthCommByClient[client].toLocaleString()} 원</span>
                    </div>
                `;
            }
        }
        baseFareContainer.innerHTML = html;
    }

    const subCommRow = document.getElementById('summarySubCarCommissionRow');
    if (subCarComm > 0) {
        subCommRow.style.display = 'flex';
        document.getElementById('summarySubCarCommissionLabel').textContent = subCarCommLabel;
        document.getElementById('summarySubCarCommissionFare').textContent = `- ${subCarComm.toLocaleString()} 원`;
    } else {
        subCommRow.style.display = 'none';
    }

    const savedSettings = getUserSettings();
    const palletRow = document.getElementById('summaryPalletRow');

    const isMain = activeLogId === 'main';
    const activeFixedOn = isMain ? savedSettings.fixedOn : savedSettings.subFixedOn;
    const activePalletOn = !!getFixedRouteClient(savedSettings)?.palletOn;

    if (activeFixedOn && activePalletOn && palletTotal > 0) {
        palletRow.style.display = 'flex';
        document.getElementById('summaryPalletFare').textContent = `${palletTotal.toLocaleString()} 원`;
    } else {
        palletRow.style.display = 'none';
    }

    const vat = Math.round((fareTotal + palletTotal) * 0.1);
    const grandTotal = fareTotal + palletTotal - commissionTotal - subCarComm + vat;

    document.getElementById('summaryVat').textContent = `${vat.toLocaleString()} 원`;
    document.getElementById('summaryTotal').textContent = `${grandTotal.toLocaleString()} 원`;

    const maintRow = document.getElementById('summaryMaintRow');
    if (maintTotal > 0) {
        maintRow.style.display = 'flex';
        document.getElementById('summaryMaintFare').textContent = `${maintTotal.toLocaleString()} 원`;
    } else {
        maintRow.style.display = 'none';
    }

    const fuelRow = document.getElementById('summaryFuelRow');
    if (fuelTotal > 0 && fuelRow) {
        fuelRow.style.display = 'flex';
        document.getElementById('summaryFuelFare').textContent = `${fuelTotal.toLocaleString()} 원`;
    } else if (fuelRow) {
        fuelRow.style.display = 'none';
    }

    const miscRow = document.getElementById('summaryMiscRow');
    if (miscTotal > 0 && miscRow) {
        miscRow.style.display = 'flex';
        document.getElementById('summaryMiscFare').textContent = `${miscTotal.toLocaleString()} 원`;
    } else if (miscRow) {
        miscRow.style.display = 'none';
    }

    updateOverdueNotification();
}

function setFixedCount(count) {
    const input = document.getElementById('modalFixedCountInput');
    if (!input) return;
    const currentCount = parseInt(input.value, 10) || 0;
    input.value = currentCount === count ? '' : count;
    syncFixedCountQuickButtons();
    autoSaveWorkRecord();
}

function syncFixedCountQuickButtons() {
    const input = document.getElementById('modalFixedCountInput');
    const selectedCount = input ? parseInt(input.value, 10) : 0;
    document.querySelectorAll('.fixed-count-quick-buttons button').forEach(button => {
        button.classList.toggle('active', selectedCount === parseInt(button.dataset.count, 10));
    });
}

// 예전엔 항상 정확히 5개로 고정(부족하면 1,2,3...으로 채움)이었는데, 이제 "+ 버튼 추가"로
// 늘릴 수 있으니 5개로 강제하지 않는다 — 입력된 개수를 그대로 쓰되 RUN_COUNT_PRESET_MAX를
// 넘지 않게만 자르고, 완전히 빈 값(최초 진입 등)일 때만 기존 기본값 1~5로 채운다.
const RUN_COUNT_PRESET_MAX = 10;

function normalizeRunCountPresets(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
    const values = [];
    source.forEach(item => {
        const count = parseInt(item, 10);
        if (count > 0 && !values.includes(count) && values.length < RUN_COUNT_PRESET_MAX) values.push(count);
    });
    if (!values.length) return [1, 2, 3, 4, 5];
    return values;
}

function getRunCountPresetChipValues(scope = 'main') {
    const containerId = scope === 'sub' ? 'subRunCountPresetChips' : 'runCountPresetChips';
    const inputs = document.querySelectorAll(`#${containerId} .run-count-preset-chip`);
    const used = [];
    return Array.from(inputs, (input, index) => {
        let count = parseInt(input.value, 10);
        if (!(count > 0) || used.includes(count)) {
            count = index + 1;
            while (used.includes(count)) count++;
        }
        used.push(count);
        return count;
    });
}

// 이제 입력칸 자체를 이 함수가 직접 그린다(예전엔 정적 5개 <input>에 값만 채웠음) — 개수가
// 가변적이라 매번 다시 그리는 게 "몇 개가 있어야 하는지"를 따로 추적하는 것보다 단순하다.
function setRunCountPresetChipValues(scope = 'main', value) {
    const containerId = scope === 'sub' ? 'subRunCountPresetChips' : 'runCountPresetChips';
    const container = document.getElementById(containerId);
    if (!container) return;
    const presets = normalizeRunCountPresets(value);

    container.innerHTML = '';
    presets.forEach((count, index) => {
        const wrap = document.createElement('span');
        wrap.className = 'run-count-preset-chip-wrap';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'run-count-preset-chip';
        input.setAttribute('inputmode', 'numeric');
        input.min = '1';
        input.value = count;
        input.setAttribute('aria-label', `${index + 1}번째 횟수 버튼`);
        input.addEventListener('input', () => saveSettings());
        input.addEventListener('blur', () => {
            if (scope === 'sub') normalizeSubRunCountPresetInput(); else normalizeRunCountPresetInput();
            saveSettings();
        });
        wrap.appendChild(input);

        // 버튼이 딱 1개 남았을 땐 지울 수 없게 한다(횟수 버튼 자체가 없어지면 안 되므로).
        if (presets.length > 1) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'run-count-preset-chip-remove';
            removeBtn.textContent = '×';
            removeBtn.title = '이 버튼 삭제';
            removeBtn.setAttribute('aria-label', `${count}회 버튼 삭제`);
            removeBtn.addEventListener('click', () => removeRunCountPresetChip(scope, index));
            wrap.appendChild(removeBtn);
        }

        container.appendChild(wrap);
    });

    const addBtn = document.getElementById(scope === 'sub' ? 'subRunCountPresetAddBtn' : 'runCountPresetAddBtn');
    if (addBtn) addBtn.disabled = presets.length >= RUN_COUNT_PRESET_MAX;
}

// "+ 버튼 추가" — 마지막 값 다음(안 겹치면)이나 안 쓰인 가장 작은 양수를 새 버튼으로 붙인다.
function addRunCountPresetChip(scope = 'main') {
    const current = getRunCountPresetChipValues(scope);
    if (current.length >= RUN_COUNT_PRESET_MAX) {
        showToastMessage(`횟수 버튼은 최대 ${RUN_COUNT_PRESET_MAX}개까지 추가할 수 있습니다.`);
        return;
    }
    let next = (current[current.length - 1] || 0) + 1;
    while (current.includes(next)) next++;
    setRunCountPresetChipValues(scope, [...current, next]);
    saveSettings();
}

function removeRunCountPresetChip(scope, index) {
    const current = getRunCountPresetChipValues(scope);
    if (current.length <= 1) return;
    current.splice(index, 1);
    setRunCountPresetChipValues(scope, current);
    saveSettings();
}

function normalizeRunCountPresetInput() {
    setRunCountPresetChipValues('main', getRunCountPresetChipValues('main'));
}

function toggleRunCountPresetSettings() {
    const toggle = document.getElementById('runCountToggle');
    const setting = document.getElementById('runCountPresetSettings');
    setSettingsGroupExpanded(setting, !!toggle?.checked, 'flex');
}

function renderFixedCountQuickButtons(settings, isMain) {
    const container = document.getElementById('fixedCountQuickButtons');
    if (!container) return;
    const enabled = isMain ? !!settings.runCountToggle : !!settings.subRunCountToggle;
    container.style.display = enabled ? 'grid' : 'none';
    container.innerHTML = '';
    if (!enabled) return;

    const presets = isMain ? settings.runCountPresets : settings.subRunCountPresets;
    normalizeRunCountPresets(presets).forEach(count => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.count = count;
        button.textContent = `${count}회`;
        button.addEventListener('click', () => setFixedCount(count));
        container.appendChild(button);
    });
}

// ========== 고정노선 "상하차지 사용" — 자주 다니는 노선 등록 & 원탭 기록 ==========
// 고정노선(기존)은 그날 총 운행 "횟수"만 기록했다. 매일 같은 구간(부산→대구 등)만 도는
// 기사에게는 그 횟수가 "몇 번 눌렀는지"만 남고 "어느 노선이었는지"는 안 남아서, 상하차지가
// 필요한 세부 기록이나 통계에는 못 썼다. 이 기능은 그 갭을 메운다 — 앱 설정에서 자주 다니는
// 노선을 미리 등록해 두면, 일일운행에서 원탭으로 "이 노선 1회"를 기록할 수 있고, 노선별
// 횟수(fixedRouteCounts)와 전체 총 횟수(fixedCount, 기존 계산 로직 그대로 재사용)가 함께
// 올라간다. 총 횟수 입력칸 자체는 그대로 남겨둬서, 노선 없이 그냥 숫자만 쓰던 기존 방식도
// 계속 쓸 수 있다.

function toggleFixedRoutePresetSettings(scope) {
    const toggle = document.getElementById(scope === 'sub' ? 'subFixedRouteToggle' : 'fixedRouteToggle');
    const setting = document.getElementById(scope === 'sub' ? 'subFixedRoutePresetSettings' : 'fixedRoutePresetSettings');
    setSettingsGroupExpanded(setting, !!toggle?.checked, 'flex');
}

function getFixedRoutePresets(settings, scope) {
    const key = scope === 'sub' ? 'subFixedRoutePresets' : 'fixedRoutePresets';
    return Array.isArray(settings[key]) ? settings[key] : [];
}

// 앱 설정 화면의 "자주 다니는 노선 등록" 목록을 다시 그린다.
function renderFixedRoutePresetList(scope) {
    const container = document.getElementById(scope === 'sub' ? 'subFixedRoutePresetList' : 'fixedRoutePresetList');
    if (!container) return;
    const presets = getFixedRoutePresets(getUserSettings(), scope);

    if (!presets.length) {
        container.innerHTML = '<div class="fixed-route-preset-empty">등록된 노선이 없습니다.</div>';
        return;
    }
    container.innerHTML = '';
    presets.forEach(route => {
        const row = document.createElement('div');
        row.className = 'fixed-route-preset-row';
        const label = document.createElement('span');
        label.textContent = `${route.loadLoc} → ${route.unloadLoc}`;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = '노선 삭제';
        removeBtn.setAttribute('aria-label', `${route.loadLoc} → ${route.unloadLoc} 삭제`);
        removeBtn.addEventListener('click', () => removeFixedRoutePreset(scope, route.id));
        row.append(label, removeBtn);
        container.appendChild(row);
    });
}

function addFixedRoutePreset(scope) {
    const loadInput = document.getElementById(scope === 'sub' ? 'subFixedRoutePresetLoadInput' : 'fixedRoutePresetLoadInput');
    const unloadInput = document.getElementById(scope === 'sub' ? 'subFixedRoutePresetUnloadInput' : 'fixedRoutePresetUnloadInput');
    const loadLoc = loadInput?.value.trim() || '';
    const unloadLoc = unloadInput?.value.trim() || '';
    if (!loadLoc || !unloadLoc) {
        showToastMessage('상차지와 하차지를 모두 입력해 주세요.');
        return;
    }

    const settings = getUserSettings();
    const key = scope === 'sub' ? 'subFixedRoutePresets' : 'fixedRoutePresets';
    const presets = Array.isArray(settings[key]) ? [...settings[key]] : [];
    if (presets.length >= 10) {
        showToastMessage('노선은 최대 10개까지 등록할 수 있습니다.');
        return;
    }
    presets.push({ id: generateLocalId('route'), loadLoc, unloadLoc });
    settings[key] = presets;
    setUserSettings(settings);

    if (loadInput) loadInput.value = '';
    if (unloadInput) unloadInput.value = '';
    renderFixedRoutePresetList(scope);
}

function removeFixedRoutePreset(scope, routeId) {
    const settings = getUserSettings();
    const key = scope === 'sub' ? 'subFixedRoutePresets' : 'fixedRoutePresets';
    settings[key] = (Array.isArray(settings[key]) ? settings[key] : []).filter(route => route.id !== routeId);
    setUserSettings(settings);
    renderFixedRoutePresetList(scope);
}

// 일일운행 입력 화면의 노선 원탭 칩을 그린다. 각 칩은 "상차지 → 하차지 (오늘 횟수)"를
// 보여주고, 누르면 그 노선 1회가 추가된다. 1회 이상 기록된 노선에는 되돌리기(−) 버튼도 같이
// 보인다.
function renderFixedRouteQuickButtons(settings, isMain) {
    const container = document.getElementById('fixedRouteQuickButtons');
    if (!container) return;
    const enabled = isMain ? !!settings.fixedRouteOn : !!settings.subFixedRouteOn;
    const presets = getFixedRoutePresets(settings, isMain ? 'main' : 'sub');
    container.style.display = (enabled && presets.length) ? 'flex' : 'none';
    container.innerHTML = '';
    if (!enabled || !presets.length) return;

    presets.forEach(route => {
        const count = currentTempFixedRouteCounts[route.id] || 0;
        const chip = document.createElement('span');
        chip.className = 'fixed-route-chip';

        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'fixed-route-chip-select';
        selectButton.innerHTML = `${escapeDetailText(route.loadLoc)} → ${escapeDetailText(route.unloadLoc)}${count > 0 ? ` <span class="fixed-route-chip-count">${count}회</span>` : ''}`;
        selectButton.addEventListener('click', () => addFixedRouteRun(route.id, isMain));
        chip.appendChild(selectButton);

        if (count > 0) {
            const minusButton = document.createElement('button');
            minusButton.type = 'button';
            minusButton.className = 'fixed-route-chip-minus';
            minusButton.textContent = '−';
            minusButton.title = '한 번 취소';
            minusButton.setAttribute('aria-label', `${route.loadLoc} → ${route.unloadLoc} 1회 취소`);
            minusButton.addEventListener('click', () => removeFixedRouteRun(route.id, isMain));
            chip.appendChild(minusButton);
        }

        container.appendChild(chip);
    });
}

// 노선 칩 원탭 — 그 노선 카운트를 1 늘리고, 기존 "총 횟수" 입력칸에도 그대로 더한다(모든
// 매출/세금계산서 계산이 이미 fixedCount 하나만 보고 있으므로, 이렇게 해야 기존 계산 로직을
// 하나도 안 건드리고 노선별 기록만 얹을 수 있다).
function addFixedRouteRun(routeId, isMain) {
    currentTempFixedRouteCounts[routeId] = (currentTempFixedRouteCounts[routeId] || 0) + 1;
    const countInput = document.getElementById('modalFixedCountInput');
    if (countInput) countInput.value = (parseInt(countInput.value, 10) || 0) + 1;

    const settings = getUserSettings();
    renderFixedRouteQuickButtons(settings, isMain);
    syncFixedCountQuickButtons();
    autoSaveWorkRecord();
}

function removeFixedRouteRun(routeId, isMain) {
    const current = currentTempFixedRouteCounts[routeId] || 0;
    if (current <= 0) return;
    currentTempFixedRouteCounts[routeId] = current - 1;
    if (currentTempFixedRouteCounts[routeId] <= 0) delete currentTempFixedRouteCounts[routeId];

    const countInput = document.getElementById('modalFixedCountInput');
    if (countInput) countInput.value = Math.max(0, (parseInt(countInput.value, 10) || 0) - 1);

    const settings = getUserSettings();
    renderFixedRouteQuickButtons(settings, isMain);
    syncFixedCountQuickButtons();
    autoSaveWorkRecord();
}

function openModal(dateKey, month, day) {
    selectedDateKey = dateKey;
    appState.selectedDateKey = dateKey; // appState 객체 동기화 추가
    document.getElementById('modalTitle').textContent = `${month}월 ${day}일 운행 일지`;

    const savedSettings = getUserSettings();
    const isMain = activeLogId === 'main';
    const fixedOn = isMain ? savedSettings.fixedOn : savedSettings.subFixedOn;
    const palletOn = !!getFixedRouteClient(savedSettings)?.palletOn;
    const callDetailOn = isMain
        ? (savedSettings.hasOwnProperty('callDetailOn') ? !!savedSettings.callDetailOn : true)
        : (savedSettings.hasOwnProperty('subCallDetailOn') ? !!savedSettings.subCallDetailOn : true);

    document.getElementById('modalFixedSection').style.display = fixedOn ? 'block' : 'none';
    document.getElementById('modalPalletSection').style.display = (fixedOn && palletOn) ? 'block' : 'none';
    document.getElementById('modalCallDetailSection').style.display = callDetailOn ? 'block' : 'none';
    renderFixedCountQuickButtons(savedSettings, isMain);

    const record = workData[dateKey];

    currentTempMaintItems = [];
    currentTempCallDetails = [];
    currentTempFuelItems = [];
    currentTempMiscItems = [];
    currentTempFixedRouteCounts = {};

    if (record) {
        setOffState(!!record.isOff);
        document.getElementById('modalFixedCountInput').value = record.fixedCount || '';
        document.getElementById('modalPalletCount').value = record.palletCount || '';

        if (record.maintItems && record.maintItems.length > 0) {
            currentTempMaintItems = JSON.parse(JSON.stringify(record.maintItems));
        }
        if (record.fuelItems && record.fuelItems.length > 0) {
            currentTempFuelItems = JSON.parse(JSON.stringify(record.fuelItems));
        }
        if (record.miscItems && record.miscItems.length > 0) {
            currentTempMiscItems = JSON.parse(JSON.stringify(record.miscItems));
        }
        if (record.callDetails && record.callDetails.length > 0) {
            currentTempCallDetails = JSON.parse(JSON.stringify(record.callDetails));
        }
        if (record.fixedRouteCounts && typeof record.fixedRouteCounts === 'object') {
            currentTempFixedRouteCounts = JSON.parse(JSON.stringify(record.fixedRouteCounts));
        }
    } else {
        setOffState(false);
        document.getElementById('modalFixedCountInput').value = '';
        document.getElementById('modalPalletCount').value = '';
    }

    renderFixedRouteQuickButtons(savedSettings, isMain);
    syncFixedCountQuickButtons();

    renderMaintSummaryInMainModal();
    renderFuelSummaryInMainModal();
    renderMiscSummaryInMainModal();
    renderCallDetailSummaryInMainModal();
    
    hideAllPages();
    document.getElementById('workModal').classList.remove('hidden');
    setActiveNav('workModal');
}

function toggleOffState() {
    setOffState(!isOffSelected);
    autoSaveWorkRecord();
}

function setOffState(off) {
    isOffSelected = off;
    const btnOff = document.getElementById('btnOffToggle');
    const workDetails = document.getElementById('modalWorkDetails');

    if (isOffSelected) {
        btnOff.classList.add('active-off');
        workDetails.style.opacity = '0.3';
        workDetails.style.pointerEvents = 'none';
    } else {
        btnOff.classList.remove('active-off');
        workDetails.style.opacity = '1';
        workDetails.style.pointerEvents = 'auto';
    }
}

function renderCallDetailSummaryInMainModal() {
    const container = document.getElementById('callDetailSummaryContainer');
    const listCard = document.getElementById('callDetailSummaryList');
    if (!container || !listCard) return;

    if (currentTempCallDetails.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    const settings = getActiveLogSettings();
    let totalFare = 0;
    let totalCommission = 0;
    let totalInsuranceFee = 0;
    let totalVat = 0;
    let totalDistance = 0;

    const formatTime = value => {
        if (!value) return '-';
        const [hourText, minute = '00'] = value.split(':');
        const hour = Number(hourText);
        return `${hour < 12 ? 'AM' : 'PM'}${hour % 12 || 12}시${minute === '00' ? '' : minute + '분'}`;
    };
    const durationText = (start, end) => {
        if (!start || !end) return '';
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let minutes = eh * 60 + em - (sh * 60 + sm);
        if (minutes < 0) minutes += 1440;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return ` (${hours ? hours + '시간' : ''}${mins ? mins + '분' : ''})`;
    };
    const getClientInfo = name => settings.clients?.find(client => client.companyName === name);
    // 저장 시점의 수수료 스냅샷(commissionSnapshot)이 있으면 그 값을 우선 사용해서, 이후
    // 거래처명 변경이나 수수료율 수정이 이미 저장된 기록의 표시값을 소급해서 바꾸지 않도록 한다.
    // 스냅샷이 없는(마이그레이션 이전) 과거 기록만 현재 거래처 설정을 참조하는 기존 방식으로 폴백한다.
    const getCommission = (item, fare) => {
        const snapshot = item.commissionSnapshot;
        let enabled, type, value;
        if (snapshot) {
            enabled = snapshot.enabled;
            type = snapshot.type;
            value = snapshot.value;
        } else {
            const client = getClientInfo(item.client);
            enabled = !!client?.commEnabled;
            type = client?.commType;
            value = client?.commValue;
        }
        if (!enabled) return { amount: 0, label: '' };
        const amount = type === 'direct'
            ? parseCurrencyValue(value)
            : Math.floor(fare * (parseFloat(value) || 0) / 100);
        const label = type === 'direct'
            ? `${parseCurrencyValue(value).toLocaleString()}원`
            : `${value}%`;
        return { amount, label };
    };

    const cardsHtml = currentTempCallDetails.map((item, index) => {
        const fare = parseCurrencyValue(item.fare);
        const commission = getCommission(item, fare);
        const vat = item.vatExempt ? 0 : Math.round(fare * 0.1);
        const insuranceFee = parseCurrencyValue(item.insuranceFee);
        const distance = parseFloat(item.distanceKm) || 0;
        const client = getClientInfo(item.client);
        const unpaid = getDetailPaymentSummary(item).status !== 'paid';
        totalFare += fare;
        totalCommission += commission.amount;
        totalInsuranceFee += insuranceFee;
        totalVat += vat;
        totalDistance += distance;

        const phoneButton = settings.paymentOn && unpaid
            ? (client?.phone
                ? `<a href="tel:${escapeDetailText(client.phone)}" class="call-phone-btn detail-call-phone" onclick="event.stopPropagation()" title="전화걸기">${callPhoneSvg()}</a>`
                : `<button type="button" class="call-phone-btn detail-call-phone" onclick="showConfirmModal('거래처에 등록된 연락처가 없습니다.', null); event.stopPropagation()" title="연락처 없음">${callPhoneSvg()}</button>`)
            : '';
        const messageButton = settings.paymentOn && unpaid
            ? `<button type="button" class="call-phone-btn detail-message-btn" onclick="openMessageTemplate(${index}); event.stopPropagation()" title="문자 보내기">${messageSvg()}</button>`
            : '';
        const badges = [
            settings.platformOn && item.platform ? item.platform : '',
            settings.paymentOn && item.receipt ? item.receipt : ''
        ].filter(Boolean).map(value => `<span class="detail-badge">${escapeDetailText(value)}</span>`).join('');
        const timeRow = settings.timeOn && (item.departureTime || item.arrivalTime)
            ? `<div class="detail-meta-line">출발:${formatTime(item.departureTime)} ➜ 도착:${formatTime(item.arrivalTime)}${durationText(item.departureTime, item.arrivalTime)}</div>`
            : '';
        const specs = [
            settings.distanceOn && distance ? `운행거리:${distance}km` : '',
            settings.cargoTonnageOn && item.cargoTonnage ? `${escapeDetailText(item.cargoTonnage)}톤` : ''
        ].filter(Boolean).join('　');

        return `<article class="call-detail-card ${unpaid ? 'unpaid-card' : ''}">
            <div class="call-detail-card-head">
                <div class="call-detail-route"><strong>${escapeDetailText(item.loadLoc || '상차지 미상')}</strong><span>➜</span><strong>${escapeDetailText(item.unloadLoc || '하차지 미상')}</strong></div>
                <div class="call-detail-actions">
                    <button type="button" class="action-icon-btn" onclick="openCallDetailModal(${index})" title="수정">${editDetailSvg()}</button>
                    <button type="button" class="action-icon-btn del" onclick="deleteCallDetail(${index})" title="삭제">${deleteDetailSvg()}</button>
                </div>
            </div>
            ${timeRow}
            <div class="detail-meta-line">거래처: ${escapeDetailText(item.client || '-')} ${commission.label ? `<span class="commission-rate">수수료 ${escapeDetailText(commission.label)}</span>` : ''}</div>
            ${specs ? `<div class="detail-meta-line">${specs}</div>` : ''}
            <div class="detail-meta-line">비고:${escapeDetailText(item.remarks || '-')}</div>
            <div class="call-detail-fare-line"><span>운송료</span><strong>${fare.toLocaleString()}원</strong></div>
            <div class="call-detail-card-foot"><div class="detail-badges">${badges}</div><div class="detail-payment-actions">${phoneButton}${messageButton}${settings.paymentOn ? `<button type="button" onclick="toggleCallPaymentStatus(${index})" class="payment-toggle-btn ${unpaid ? 'unpaid' : 'paid'}">${unpaid ? '미수' : '수금'}</button>` : ''}</div></div>
        </article>`;
    }).join('');

    const grandTotal = totalFare - totalCommission - totalInsuranceFee + totalVat;
    listCard.innerHTML = `${cardsHtml}
        <div class="call-detail-daily-summary">
            <div><b>일일 운행거리</b><strong>${totalDistance} km</strong></div>
            ${totalCommission ? `<div class="commission-row"><b>수수료</b><strong>- ${totalCommission.toLocaleString()}원</strong></div>` : ''}
            ${totalInsuranceFee ? `<div class="commission-row"><b>산재보험료</b><strong>- ${totalInsuranceFee.toLocaleString()}원</strong></div>` : ''}
            <div><b>부가세(공급가액 기준 10%)</b><strong>${totalVat.toLocaleString()}원</strong></div>
            <div class="summary-grand-total"><b>세부 내역 합계 (${currentTempCallDetails.length}건)</b><strong>${grandTotal.toLocaleString()}원</strong></div>
        </div>`;
}

function escapeDetailText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// onclick="fn('${value}')" 처럼 인라인 핸들러의 작은따옴표 문자열 인자로 사용자 입력값을 넣을 때 쓴다.
// 1) JS 문자열 리터럴 이스케이프(백슬래시/따옴표/줄바꿈) → 2) HTML 속성 이스케이프 순서로 처리해야
// onclick="..." 속성 자체를 깨거나 안의 JS 문자열 경계를 깨는 인젝션을 동시에 막을 수 있다.
function escapeForInlineHandlerArg(value) {
    const jsEscaped = String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
    return escapeDetailText(jsEscaped);
}

function callPhoneSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 1 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
}

function messageSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path><path d="M8 9h8M8 13h5"></path></svg>';
}

function getDefaultMessageTemplatePatterns() {
    return [
        '안녕하세요, {거래처} 담당자님. {운행구간} 운송료 {운송료}원이 미수 상태입니다. 확인 부탁드립니다.',
        '안녕하세요. {운행구간} 운송 건 운송료 {운송료}원 입금 부탁드립니다. 감사합니다.',
        '안녕하세요, {거래처} 담당자님. {운행구간} 운행이 완료되었습니다. 이용해 주셔서 감사합니다.'
    ];
}

function getMessageTemplatePatterns() {
    const defaults = getDefaultMessageTemplatePatterns();

    try {
        const saved = JSON.parse(localStorage.getItem('messageTemplateCustomBodies') || 'null');
        return Array.isArray(saved) && saved.length === defaults.length
            ? defaults.map((body, index) => String(saved[index] || body))
            : defaults;
    } catch (error) {
        return defaults;
    }
}

function fillMessageTemplatePattern(pattern, values) {
    return String(pattern)
        .replaceAll('{거래처}', values.company)
        .replaceAll('{운행구간}', values.route)
        .replaceAll('{운송료}', values.fare);
}

function openMessageTemplate(index) {
    const item = currentTempCallDetails[index];
    if (!item) {
        showToastMessage('문자 전송 내역을 찾을 수 없습니다.');
        return;
    }
    const settings = getActiveLogSettings();
    const client = settings.clients?.find(entry => entry.companyName === item.client);
    if (!client?.phone) {
        showConfirmModal('거래처에 등록된 연락처가 없습니다.', null);
        return;
    }
    document.getElementById('messageTemplateSheet')?.remove();
    const fare = parseCurrencyValue(item.fare).toLocaleString();
    const company = item.client || '거래처';
    const route = `${item.loadLoc || '상차지'} → ${item.unloadLoc || '하차지'}`;
    const templateTitles = ['미수금 안내', '입금 요청', '운행 완료'];
    const patterns = getMessageTemplatePatterns();
    const templates = patterns.map((pattern, templateIndex) => ({
        title: templateTitles[templateIndex],
        body: fillMessageTemplatePattern(pattern, { company, route, fare })
    }));
    const sheet = document.createElement('div');
    sheet.id = 'messageTemplateSheet';
    sheet.className = 'message-template-overlay';
    sheet.onclick = event => { if (event.target === sheet) sheet.remove(); };
    sheet.innerHTML = `<section class="message-template-sheet" role="dialog" aria-modal="true" aria-label="문자 양식 선택"><div class="message-template-head"><div><strong>문자 보내기</strong><span>${escapeDetailText(company)} · ${escapeDetailText(client.phone)}</span></div><button type="button" onclick="this.closest('.message-template-overlay').remove()" aria-label="닫기">×</button></div><p class="message-template-help">보낼 양식을 선택하면 문자 앱에서 내용을 확인하고 수정할 수 있습니다.</p><div class="message-template-list">${templates.map((template, templateIndex) => `<button type="button" onclick="sendMessageTemplate(${templateIndex})"><strong>${template.title}</strong><span>${escapeDetailText(template.body)}</span></button>`).join('')}</div></section>`;
    sheet._templates = templates;
    sheet._phone = client.phone;
    document.body.appendChild(sheet);
}

function sendMessageTemplate(templateIndex) {
    const sheet = document.getElementById('messageTemplateSheet');
    const phone = sheet?._phone || '';
    const body = sheet?._templates?.[templateIndex]?.body || '';
    if (!phone || !body) {
        showToastMessage('문자 내용을 불러오지 못했습니다.');
        return;
    }
    const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
    window.location.href = `sms:${phone}${separator}body=${encodeURIComponent(body)}`;
    sheet?.remove();
}

function editDetailSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
}

function fuelIconSvg(className = '', style = '') {
    const classAttribute = className ? ` class="${className}"` : '';
    const styleAttribute = style ? ` style="${style}"` : '';
    return `<svg${classAttribute} viewBox="0 0 24 24"${styleAttribute} aria-hidden="true"><line x1="3" x2="15" y1="22" y2="22"></line><line x1="4" x2="14" y1="9" y2="9"></line><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"></path><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"></path></svg>`;
}

function deleteDetailSvg() {
    return '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
}

function calculateCallDetailComm() {
    const fareInput = document.getElementById('callDetailFare').value;
    const clientName = document.getElementById('callClient').value;
    const infoDiv = document.getElementById('callDetailCommInfo');
    
    let gross = parseCurrencyValue(fareInput);
    if(gross === 0 || !clientName) {
        infoDiv.style.display = 'none';
        return;
    }

    const settings = getUserSettings();
    const clientObj = settings.clients?.find(c => c.companyName === clientName);

    if(clientObj && clientObj.commEnabled) {
        let comm = 0;
        if(clientObj.commType === 'percent' || !clientObj.commType) {
            comm = Math.floor(gross * (parseFloat(clientObj.commValue) / 100));
        } else {
            comm = parseCurrencyValue(clientObj.commValue);
        }
        
        document.getElementById('callDetailCommText').textContent = comm.toLocaleString();
        document.getElementById('callDetailNetFare').textContent = (gross - comm).toLocaleString();
        infoDiv.style.display = 'block';
    } else {
        infoDiv.style.display = 'none';
    }
}

// 운송료 입력창 바로 아래에 "부가세 포함 예상 금액"을 실시간으로 보여준다.
// 계산 로직은 기존 vat = Math.round(fare * 0.1)과 동일하게 맞춰 표시용으로만 재사용한다.
function updateCallDetailVatPreview() {
    const fareInput = document.getElementById('callDetailFare');
    const previewEl = document.getElementById('callDetailVatPreview');
    if (!fareInput || !previewEl) return;

    const fare = parseCurrencyValue(fareInput.value);
    if (!fare) {
        previewEl.style.display = 'none';
        previewEl.textContent = '';
        return;
    }

    const vatExemptToggle = document.getElementById('callVatExemptToggle');
    const isVatExempt = !!vatExemptToggle?.checked;

    if (isVatExempt) {
        previewEl.textContent = '면세 거래로 부가세가 적용되지 않습니다.';
        previewEl.style.display = 'block';
        return;
    }

    const vat = Math.round(fare * 0.1);
    previewEl.textContent = `부가세 포함 ${(fare + vat).toLocaleString()}원`;
    previewEl.style.display = 'block';
}

function selectCallReceipt(value) {
    const container = document.getElementById('callReceiptGroup');
    const hiddenInput = document.getElementById('callReceiptValue');
    if (!container || !hiddenInput) return;

    const isAlreadyActive = hiddenInput.value === value;
    hiddenInput.value = isAlreadyActive ? '' : value;
    container.querySelectorAll('.dark-pill-btn').forEach(button => {
        button.classList.toggle('active', !isAlreadyActive && button.textContent.trim() === value);
    });
}
// 세부입력 "직전 항목과 동일하게 채우기"용 — 오늘 이미 넣어둔 게 있으면 그중 마지막 것,
// 없으면 가장 최근 날짜의 마지막 콜상세를 돌려준다. getFrequentAndRecentLocations()와 같은
// 데이터 소스(currentTempCallDetails → workData 역순)를 쓰되, 여긴 "가장 최근 1건 전체"만
// 필요하므로 훨씬 단순하다.
function getMostRecentCallDetail() {
    if (currentTempCallDetails.length) return currentTempCallDetails[currentTempCallDetails.length - 1];
    const dates = Object.keys(workData).sort().reverse();
    for (const dateKey of dates) {
        const details = workData[dateKey]?.callDetails || [];
        if (details.length) return details[details.length - 1];
    }
    return null;
}

// "손으로 몇 글자만 적으면 되는 수첩"과의 입력 속도 격차를 줄이기 위한 원탭 기능 — 매번
// 거래처/상차지/하차지를 처음부터 타이핑하지 않고, 같은 노선을 반복 운행하는 경우 직전
// 항목을 그대로 채운 뒤 운송료 등 달라지는 값만 고치면 되게 한다. 시간/거리/영수증/결제
// 상태처럼 "이번 건에만 해당하는" 필드는 일부러 복사하지 않는다.
function copyPreviousCallDetail() {
    const prev = getMostRecentCallDetail();
    if (!prev) {
        showToastMessage('복사할 이전 입력 내역이 없습니다.');
        return;
    }
    document.getElementById('callLoadLoc').value = prev.loadLoc || '';
    document.getElementById('callUnloadLoc').value = prev.unloadLoc || '';
    document.getElementById('callClient').value = prev.client || '';
    if (prev.fare) document.getElementById('callDetailFare').value = parseCurrencyValue(prev.fare).toLocaleString();
    if (document.getElementById('callCargoTonnage') && prev.cargoTonnage) {
        document.getElementById('callCargoTonnage').value = prev.cargoTonnage;
    }
    clearCallDetailRequiredError();
    calculateCallDetailComm();
    applyClientPaymentTerms();
    updateCallDetailVatPreview();
    showToastMessage('직전 항목 내용을 채웠습니다. 달라진 부분만 고쳐 주세요.');
}

function openCallDetailModal(index = -1) {
    if (isOffSelected) setOffState(false);
    
    const settings = getActiveLogSettings();

    populateClientDataList();
    populateLocationDataLists();
    renderPinnedClientShortcuts();
    activeLocationShortcutTarget = 'load';
    renderLocationShortcuts();

    // "직전 항목과 동일하게" 버튼은 새로 추가할 때만 의미가 있다(수정 중엔 이미 값이 다
    // 채워져 있음) — 그리고 복사할 대상이 아예 없으면(첫 입력) 굳이 보여줄 필요가 없다.
    const copyPrevBtn = document.getElementById('callDetailCopyPrevBtn');
    if (copyPrevBtn) copyPrevBtn.hidden = index !== -1 || !getMostRecentCallDetail();

    const titleEl = document.getElementById('callDetailModalTitle');
    if (titleEl && selectedDateKey) {
        const dayMatch = selectedDateKey.split('-');
        if (dayMatch.length === 3) {
            titleEl.textContent = `${parseInt(dayMatch[2], 10)}일 일지 세부 입력`;
        }
    }

    const timeEl = document.getElementById('callDetailTimeSection');
    const receiptEl = document.getElementById('callDetailReceiptSection');
    const distEl = document.getElementById('callDetailDistanceSection');
    const platformEl = document.getElementById('callPlatformContainer');
    
    if(timeEl) timeEl.style.display = settings.timeOn ? 'grid' : 'none';
    if(receiptEl) receiptEl.style.display = settings.paymentOn ? 'block' : 'none';
    if(distEl) distEl.style.display = settings.distanceOn ? 'grid' : 'none';
    if(platformEl) platformEl.style.display = settings.platformOn ? 'block' : 'none';

    const cargoTonnageSection = document.getElementById('callCargoTonnageSection');
    if (cargoTonnageSection) {
        cargoTonnageSection.style.display = settings.hasOwnProperty('cargoTonnageOn') ? (settings.cargoTonnageOn ? 'grid' : 'none') : 'grid';
    }

    document.getElementById('callDetailEditIndex').value = index;

    document.getElementById('callLoadLoc').value = '';
    document.getElementById('callUnloadLoc').value = '';
    document.getElementById('callDetailFare').value = '';
    clearCallDetailRequiredError();
    if (document.getElementById('callEndOdometer')) document.getElementById('callEndOdometer').classList.remove('input-error');
    document.getElementById('callClient').value = '';
    document.getElementById('callRemarks').value = '';
    if(document.getElementById('callCargoTonnage')) document.getElementById('callCargoTonnage').value = '';
    
    if(document.getElementById('callDepartureTime')) document.getElementById('callDepartureTime').value = '';
    if(document.getElementById('callArrivalTime')) document.getElementById('callArrivalTime').value = '';
    if(document.getElementById('callDistanceKm')) document.getElementById('callDistanceKm').value = '';
    if(document.getElementById('callStartOdometer')) document.getElementById('callStartOdometer').value = '';
    if(document.getElementById('callEndOdometer')) document.getElementById('callEndOdometer').value = '';
    if(document.getElementById('callVatExemptToggle')) document.getElementById('callVatExemptToggle').checked = false;
    if(document.getElementById('callInsuranceFee')) document.getElementById('callInsuranceFee').value = '';
    if(document.getElementById('callPaymentDueDate')) document.getElementById('callPaymentDueDate').value = '';
    
    if(document.getElementById('callReceiptValue')) document.getElementById('callReceiptValue').value = '';
    if(document.getElementById('callPlatform')) document.getElementById('callPlatform').value = '';
    
    document.querySelectorAll('#callReceiptGroup .dark-pill-btn').forEach(b => b.classList.remove('active'));
    if (index >= 0 && currentTempCallDetails[index]) {
        const item = currentTempCallDetails[index];
        document.getElementById('callLoadLoc').value = item.loadLoc || '';
        document.getElementById('callUnloadLoc').value = item.unloadLoc || '';
        document.getElementById('callDetailFare').value = parseCurrencyValue(item.fare).toLocaleString() || '';
        document.getElementById('callClient').value = item.client || '';
        document.getElementById('callRemarks').value = item.remarks || '';
        if(document.getElementById('callCargoTonnage')) document.getElementById('callCargoTonnage').value = item.cargoTonnage || '';
        
        if(item.departureTime && document.getElementById('callDepartureTime')) document.getElementById('callDepartureTime').value = item.departureTime;
        if(item.arrivalTime && document.getElementById('callArrivalTime')) document.getElementById('callArrivalTime').value = item.arrivalTime;
        if(item.distanceKm && document.getElementById('callDistanceKm')) document.getElementById('callDistanceKm').value = item.distanceKm;
        if(document.getElementById('callStartOdometer')) document.getElementById('callStartOdometer').value = item.startOdometer || '';
        if(document.getElementById('callEndOdometer')) document.getElementById('callEndOdometer').value = item.endOdometer || '';
        if(document.getElementById('callVatExemptToggle')) document.getElementById('callVatExemptToggle').checked = !!item.vatExempt;
        if(document.getElementById('callInsuranceFee')) document.getElementById('callInsuranceFee').value = item.insuranceFee ? parseCurrencyValue(item.insuranceFee).toLocaleString() : '';
        if(document.getElementById('callPaymentDueDate')) document.getElementById('callPaymentDueDate').value = item.paymentDueDate || '';
        
        if (item.receipt) selectCallReceipt(item.receipt);
        if (item.platform && document.getElementById('callPlatform')) document.getElementById('callPlatform').value = item.platform;
    }
    
    const detailContainer = document.getElementById('callDetailModal');
    const inlineHost = document.getElementById('callDetailInlineHost');
    if (detailContainer && inlineHost) {
        if (!detailContainer.dataset.originalParentReady) {
            detailContainer.dataset.originalParentReady = 'true';
        }
        inlineHost.appendChild(detailContainer);
        detailContainer.classList.remove('hidden');
        detailContainer.classList.add('inline-expanded');
        inlineHost.classList.add('is-open');
        inlineHost.setAttribute('aria-hidden', 'false');
        if (!detailContainer._inlineResizeObserver && typeof ResizeObserver !== 'undefined') {
            detailContainer._inlineResizeObserver = new ResizeObserver(() => {
                if (inlineHost.classList.contains('is-open')) {
                    inlineHost.style.maxHeight = `${Math.ceil(detailContainer.scrollHeight) + 4}px`;
                }
            });
            detailContainer._inlineResizeObserver.observe(detailContainer);
        }
        requestAnimationFrame(() => {
            detailContainer.classList.add('is-visible');
            inlineHost.style.maxHeight = `${Math.ceil(detailContainer.scrollHeight) + 4}px`;
            setTimeout(() => {
                inlineHost.style.maxHeight = `${Math.ceil(detailContainer.scrollHeight) + 4}px`;
                detailContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 80);
        });
    }
    calculateCallDetailComm();
    updateCallDetailVatPreview();
}

function closeCallDetailModal() {
    const detailContainer = document.getElementById('callDetailModal');
    const inlineHost = document.getElementById('callDetailInlineHost');
    if (!detailContainer || !inlineHost || !detailContainer.classList.contains('inline-expanded')) {
        detailContainer?.classList.add('hidden');
        return;
    }

    detailContainer.classList.remove('is-visible');
    inlineHost.style.maxHeight = '0px';
    inlineHost.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
        detailContainer.classList.add('hidden');
        detailContainer.classList.remove('inline-expanded');
        inlineHost.classList.remove('is-open');
    }, 420);
}

function setCallPlatform(platformName) {
    const input = document.getElementById('callPlatform');
    if (!input) return;
    input.value = input.value === platformName ? '' : platformName;
    document.querySelectorAll('.call-platform-quick-list .dark-pill-btn').forEach(button => {
        button.classList.toggle('active', button.textContent.trim() === input.value);
    });
}

// 필수 입력 필드 인라인 오류 표시(.input-error)를 다루는 범용 헬퍼.
// id 또는 엘리먼트를 직접 받아, 값이 비어있으면 표시하고(markFieldError) 사용자가 입력하면 지운다(clearFieldError).
function markFieldError(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (el && el.classList) el.classList.add('input-error');
}

function clearFieldError(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (el && el.classList) el.classList.remove('input-error');
}

function clearCallDetailRequiredError(input) {
    [document.getElementById('callDetailFare'), document.getElementById('callLoadLoc'), document.getElementById('callUnloadLoc')]
        .forEach(clearFieldError);
}

// 정비/기타지출 저장 시 "항목명 또는 비용 중 하나만 있으면 통과"하는 필드 쌍의 인라인
// 오류를 함께 지운다(둘 중 하나만 채워도 검증을 통과하므로, 어느 쪽에 입력해도 둘 다 해제).
function clearMaintRequiredError() {
    [document.getElementById('maintRecordName'), document.getElementById('maintRecordFare')]
        .forEach(clearFieldError);
}

// 주유 기록 저장 시 "비용 또는 주유량 중 하나만 있으면 통과"하는 필드 쌍의 인라인 오류를
// 함께 지운다.
function clearFuelRequiredError() {
    [document.getElementById('fuelDetailCost'), document.getElementById('fuelDetailLiter')]
        .forEach(clearFieldError);
}

function updateCallDetailDistance() {
    const startInput = document.getElementById('callStartOdometer');
    const endInput = document.getElementById('callEndOdometer');
    const distanceInput = document.getElementById('callDistanceKm');
    if (!startInput || !endInput || !distanceInput) return;

    const hasBoth = startInput.value.trim() !== '' && endInput.value.trim() !== '';
    const start = parseCurrencyValue(startInput.value);
    const end = parseCurrencyValue(endInput.value);
    distanceInput.value = hasBoth && end >= start ? end - start : '';
    endInput.classList.toggle('input-error', hasBoth && end < start);
}

function renderPinnedClientShortcuts() {
    const settings = getUserSettings();
    const container = document.getElementById('callClientShortcuts');
    if (!container) return;

    const pinnedClients = (settings.clients || []).filter(client => client.isPinned && client.companyName);
    container.innerHTML = '';
    container.style.display = pinnedClients.length ? 'flex' : 'none';

    pinnedClients.forEach(client => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dark-pill-btn';
        button.textContent = client.companyName;
        button.addEventListener('click', () => selectPinnedClient(client.companyName));
        container.appendChild(button);
    });
}

function selectPinnedClient(companyName) {
    const input = document.getElementById('callClient');
    if (!input) return;
    const shouldClear = input.value.trim() === companyName;
    input.value = shouldClear ? '' : companyName;
    document.querySelectorAll('#callClientShortcuts .dark-pill-btn').forEach(button => {
        button.classList.toggle('active', !shouldClear && button.textContent.trim() === companyName);
    });
    calculateCallDetailComm();
    applyClientPaymentTerms();
}

let clientModalOpenedFromCallDetail = false;

function openClientModalFromCallDetail() {
    clientModalOpenedFromCallDetail = true;
    openClientModal(-1);
}

function saveCallDetail() {
    const idx = parseInt(document.getElementById('callDetailEditIndex').value, 10);
    const loadLoc = document.getElementById('callLoadLoc').value.trim();
    const unloadLoc = document.getElementById('callUnloadLoc').value.trim();
    const fare = document.getElementById('callDetailFare').value.trim();
    const client = document.getElementById('callClient').value.trim();
    const remarks = document.getElementById('callRemarks').value.trim();
    const paymentDueDate = document.getElementById('callPaymentDueDate').value;
    const cargoTonnage = document.getElementById('callCargoTonnage') ? document.getElementById('callCargoTonnage').value.trim() : '';

    const departureTime = document.getElementById('callDepartureTime') ? document.getElementById('callDepartureTime').value : '';
    const arrivalTime = document.getElementById('callArrivalTime') ? document.getElementById('callArrivalTime').value : '';
    const receipt = document.getElementById('callReceiptValue') ? document.getElementById('callReceiptValue').value : '';
    const distanceKm = document.getElementById('callDistanceKm') ? document.getElementById('callDistanceKm').value.trim() : '';
    const startOdometer = document.getElementById('callStartOdometer') ? document.getElementById('callStartOdometer').value.trim() : '';
    const endOdometer = document.getElementById('callEndOdometer') ? document.getElementById('callEndOdometer').value.trim() : '';
    const vatExempt = document.getElementById('callVatExemptToggle') ? document.getElementById('callVatExemptToggle').checked : false;
    const insuranceFee = document.getElementById('callInsuranceFee') ? document.getElementById('callInsuranceFee').value.trim() : '';
    const platform = document.getElementById('callPlatform') ? document.getElementById('callPlatform').value.trim() : '';

    const fareInput = document.getElementById('callDetailFare');
    const loadLocInput = document.getElementById('callLoadLoc');
    const unloadLocInput = document.getElementById('callUnloadLoc');
    const missingRequired = !fare && !loadLoc && !unloadLoc;
    [fareInput, loadLocInput, unloadLocInput].forEach(input => {
        if (input) input.classList.toggle('input-error', missingRequired);
    });
    if (missingRequired) {
        if (fareInput) fareInput.focus();
        return;
    }

    const existingItem = idx >= 0 && currentTempCallDetails[idx] ? currentTempCallDetails[idx] : null;
    const paymentStatus = existingItem ? (existingItem.paymentStatus || '미수') : '미수';
    // 수금 이력(payments)은 이 화면에서 건드리지 않는 값이므로 수정 시에도 그대로 보존한다.
    const payments = existingItem && Array.isArray(existingItem.payments) ? existingItem.payments : [];

    // 저장 시점의 거래처 연결과 수수료 조건을 스냅샷으로 함께 남긴다. 이후 거래처명 변경이나
    // 수수료율 수정이 이미 저장된 이 기록의 표시값을 소급해서 바꾸지 않도록 하기 위함이다.
    // (신규 저장뿐 아니라 기존 기록을 수정해서 다시 저장할 때도, 그 시점의 최신 거래처 조건으로
    // 스냅샷이 새로 갱신된다.)
    const savedSettings = getUserSettings();
    const matchedClient = savedSettings.clients?.find(c => c.companyName === client);
    const clientId = matchedClient?.id || null;
    const commissionSnapshot = (matchedClient && matchedClient.commEnabled)
        ? { enabled: true, type: matchedClient.commType, value: matchedClient.commValue }
        : { enabled: false, type: null, value: null };

    const newItem = {
        loadLoc,
        unloadLoc,
        fare,
        client,
        clientId,
        commissionSnapshot,
        remarks,
        departureTime,
        arrivalTime,
        receipt,
        distanceKm,
        startOdometer,
        endOdometer,
        vatExempt,
        insuranceFee,
        platform,
        paymentStatus,
        payments,
        paymentDueDate,
        cargoTonnage,
        workDate: selectedDateKey
    };

    if (idx >= 0) {
        currentTempCallDetails[idx] = newItem;
    } else {
        currentTempCallDetails.push(newItem);
    }

    renderCallDetailSummaryInMainModal();
    if (!document.getElementById('workModal').classList.contains('hidden')) {
        autoSaveWorkRecord();
    }
    closeCallDetailModal();
}

function deleteCallDetail(index) {
    showConfirmModal('삭제하시겠습니까?', () => {
        currentTempCallDetails.splice(index, 1);
        renderCallDetailSummaryInMainModal();
        if (!document.getElementById('workModal').classList.contains('hidden')) {
            autoSaveWorkRecord();
        }
    });
}

function closeModal() {
    const openDetail = document.getElementById('callDetailModal');
    if (openDetail?.classList.contains('inline-expanded')) {
        closeCallDetailModal();
    }
    ['maintFuelSelectModal', 'maintRecordModal', 'fuelDetailModal'].forEach(id => {
        const panel = document.getElementById(id);
        if (panel?.classList.contains('inline-expanded')) {
            closeMaintFuelInlinePanel(panel);
        }
    });
    document.getElementById('workModal').classList.add('hidden');
    // showMain()을 인자 없이 호출하면 skipRedirect 기본값(false) 때문에 activeLogId가 'main'이
    // 아닐 때(기사차량 운행일지를 보던 중) switchCarLog('main')으로 강제 전환해 버린다 — 일일운행
    // 상세를 열었던 차량 컨텍스트(activeLogId)와 무관하게 항상 메인차량으로 튕기는 버그였다.
    // 이 모달은 "지금 activeLogId인 차량"의 달력에서 열렸으므로, 닫을 때도 그 차량으로 그대로
    // 돌아가야 한다 — activeLogId를 바꾸지 않고 그냥 메인 페이지(현재 로그의 달력)만 다시 보여준다.
    showMain(true);
}

let autoSaveStatusHideTimer = null;

// #workModal 제목 아래 작은 자동저장 상태 텍스트 ("저장 중..." → "저장됨"/"저장 실패", 잠시 후 자동 소멸)
function setAutoSaveStatus(state) {
    const el = document.getElementById('autoSaveStatus');
    if (!el) return;
    if (autoSaveStatusHideTimer) {
        clearTimeout(autoSaveStatusHideTimer);
        autoSaveStatusHideTimer = null;
    }
    if (state === 'saving') {
        el.textContent = '저장 중...';
        el.classList.remove('error');
        el.classList.add('visible');
    } else if (state === 'saved') {
        el.textContent = '저장되었습니다.';
        el.classList.remove('error');
        el.classList.add('visible');
        autoSaveStatusHideTimer = setTimeout(() => el.classList.remove('visible'), 1200);
    } else if (state === 'error') {
        el.textContent = '저장 실패';
        el.classList.add('error');
        el.classList.add('visible');
        autoSaveStatusHideTimer = setTimeout(() => el.classList.remove('visible'), 1800);
    }
}

function autoSaveWorkRecord() {
    if (!selectedDateKey) return;

    setAutoSaveStatus('saving');

    try {
        const savedSettings = getUserSettings();
        const isMain = activeLogId === 'main';
        const fixedOn = isMain ? savedSettings.fixedOn : savedSettings.subFixedOn;
        const palletOn = !!getFixedRouteClient(savedSettings)?.palletOn;

        let fixedCount = 0;
        let palletCount = 0;

        if (!isOffSelected) {
            if (fixedOn) {
                fixedCount = parseInt(document.getElementById('modalFixedCountInput').value, 10) || 0;

                if (palletOn) {
                    palletCount = parseInt(document.getElementById('modalPalletCount').value, 10) || 0;
                }
            }
        }

        const maintItems = currentTempMaintItems;
        const fuelItems = currentTempFuelItems;
        const miscItems = currentTempMiscItems;
        const callDetails = currentTempCallDetails;

        if (!isOffSelected && fixedCount === 0 && palletCount === 0 && maintItems.length === 0 && fuelItems.length === 0 && miscItems.length === 0 && callDetails.length === 0) {
            delete workData[selectedDateKey];
        } else {
            workData[selectedDateKey] = {
                isOff: isOffSelected,
                fixedCount,
                palletCount,
                maintItems,
                fuelItems,
                miscItems,
                callDetails,
                // 고정노선 "상하차지 사용"으로 노선별 원탭 기록을 쓰는 경우에만 값이 채워진다.
                // autoSaveWorkRecord()가 항상 workData[date]를 통째로 다시 만들기 때문에, 여기서
                // 같이 안 넣으면 다른 입력(콜상세 등)을 저장할 때마다 노선별 기록이 조용히
                // 사라진다 — 실제로 그렇게 유실되는 걸 막기 위해 처음부터 여기 넣어둔다.
                fixedRouteCounts: currentTempFixedRouteCounts
            };
        }

        saveDataToStorage();
        buildCalendar();
        setAutoSaveStatus('saved');
    } catch (error) {
        console.error('자동 저장 실패:', error);
        setAutoSaveStatus('error');
    }
}

function createTableHTML(items, showPallet) {
    const headerHTML = `
        <table class="report-table">
            <thead>
                <tr>
                    <th style="width: ${showPallet ? '30%' : '35%'};">날짜</th>
                    <th style="width: ${showPallet ? '20%' : '25%'};">운행</th>
                    ${showPallet ? '<th style="width: 20%;">파렛트</th>' : ''}
                    <th style="width: ${showPallet ? '30%' : '40%'};">금액</th>
                </tr>
            </thead>
            <tbody>`;
    
    let bodyHTML = '';
    const currentMonth = viewDate.getMonth() + 1;

    items.forEach(item => {
        const palletStr = item.palletCount > 0 ? `${item.palletCount}장` : '-';
        const workStr = item.isOff ? '휴무' : `${item.workVal}회`;
        bodyHTML += `
            <tr>
                <td>${currentMonth}월 ${item.day}일</td>
                <td>${workStr}</td>
                ${showPallet ? `<td>${palletStr}</td>` : ''}
                <td class="amount">${item.amount.toLocaleString()}원</td>
            </tr>`;
    });

    const footerHTML = `</tbody></table>`;
    return headerHTML + bodyHTML + footerHTML;
}

function buildReportPage(isForExport = false) {
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();

    document.getElementById('reportMonthTitle').textContent = `${currentYear}년 ${currentMonth + 1}월 운송비 내역서`;

    const savedSettings = getUserSettings();
    let rptName = savedSettings.userName || '-';
    let rptPhone = savedSettings.userPhone || '-';
    let rptBank = savedSettings.bankName || '-';
    let rptAccount = savedSettings.accountNumber || '-';
    let rptAccountHolder = savedSettings.accountHolder || '-';

    if (activeLogId !== 'main') {
        const currentCar = (savedSettings.cars || []).find(c => c.number === activeLogId);
        if (currentCar) {
            document.getElementById('rptCarNumber').textContent = currentCar.number || '-';
            document.getElementById('rptCarTonnage').textContent = currentCar.tonnage || '-';

            if (currentCar.logEnabled && currentCar.infoType === 'new' && currentCar.personalInfo) {
                rptName = currentCar.personalInfo.name || rptName;
                rptPhone = currentCar.personalInfo.phone || rptPhone;
                rptBank = currentCar.personalInfo.bank || rptBank;
                rptAccount = currentCar.personalInfo.account || rptAccount;
                rptAccountHolder = currentCar.personalInfo.accountHolder || rptAccountHolder;
            }
        }
    } else if (savedSettings.cars && savedSettings.cars.length > 0) {
        // 예전엔 메인 차량이 없으면(데이터 이상 등 정상적으론 발생 안 함) 그냥 목록의 첫 번째
        // 차량으로 대신했는데, 그게 서브 차량이면 그 기사 개인정보(이름/계좌 등)가 메인 차량
        // 자리에 잘못 표시될 수 있었다(§전수 점검에서 발견). 위의 서브 차량 분기(activeLogId
        // !== 'main')와 동일하게, 못 찾으면 아무 것도 대신 채우지 않고 그대로 둔다 — 엉뚱한
        // 차량 정보를 보여주는 것보다 기본값(차주 개인정보) 그대로가 안전하다.
        const mainCar = savedSettings.cars.find(c => c.type === 'main');
        if (mainCar) {
            if (mainCar.logEnabled && mainCar.infoType === 'new' && mainCar.personalInfo) {
                rptName = mainCar.personalInfo.name || rptName;
                rptPhone = mainCar.personalInfo.phone || rptPhone;
                rptBank = mainCar.personalInfo.bank || rptBank;
                rptAccount = mainCar.personalInfo.account || rptAccount;
                rptAccountHolder = mainCar.personalInfo.accountHolder || rptAccountHolder;
            }

            document.getElementById('rptCarNumber').textContent = mainCar.number || '-';
            document.getElementById('rptCarTonnage').textContent = mainCar.tonnage || '-';
        } else {
            // 이전 렌더링에서 남아있던 값이 그대로 보이지 않도록 확실히 기본값으로 되돌린다.
            document.getElementById('rptCarNumber').textContent = '-';
            document.getElementById('rptCarTonnage').textContent = '-';
        }

    } else {
        document.getElementById('rptCarNumber').textContent = '-';
        document.getElementById('rptCarTonnage').textContent = '-';
    }

    document.getElementById('rptUserName').textContent = rptName;
    document.getElementById('rptUserPhone').textContent = rptPhone;
    document.getElementById('rptBankName').textContent = rptBank;
    document.getElementById('rptAccountNumber').textContent = rptAccount;
    if (document.getElementById('rptAccountHolder')) document.getElementById('rptAccountHolder').textContent = rptAccountHolder;

    const isMain = activeLogId === 'main';
    const fixedRouteClient = getFixedRouteClient(savedSettings);
    const fixedUnitPrice = parseCurrencyValue(fixedRouteClient?.fixedUnitPrice);
    const palletUnitPrice = parseCurrencyValue(fixedRouteClient?.palletPrice);
    const showPallet = !!((isMain ? savedSettings.fixedOn : savedSettings.subFixedOn) && fixedRouteClient?.palletOn);

    let workList = [];
    let totalMonthWork = 0;
    let totalFare = 0;
    let totalPalletFare = 0;
    let totalCommission = 0;
    let totalMonthDistance = 0; // 추가: 운송비 내역서 총 운행거리 표기

    let defaultBaseFare = 0;
    let monthFareByClient = {};
    let monthCommByClient = {};
    let clientCommLabels = {};

    for (let d = 1; d <= lastDate; d++) {
        const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = workData[dateKey];

        if (record) {
            if (record.isOff) {
                workList.push({
                    day: d,
                    isOff: true,
                    workVal: 0,
                    palletCount: 0,
                    amount: 0
                });
            } else {
                let dayWorkCount = 0;
                let dayFare = 0;
                let dayPalletCount = showPallet ? (record.palletCount || 0) : 0;
                let dayDefaultFare = 0;

                if (record.fixedCount > 0) {
                    dayWorkCount += parseInt(record.fixedCount, 10);
                    let fAmt = record.fixedCount * fixedUnitPrice;
                    dayFare += fAmt;
                    // 고정 거래처가 지정돼 있으면 그 거래처 매출로 집계한다(고정노선 거래처 연동).
                    const fixedClientName = fixedRouteClient?.companyName || '';
                    if (fixedClientName) {
                        monthFareByClient[fixedClientName] = (monthFareByClient[fixedClientName] || 0) + fAmt;
                        // 콜상세 거래처와 동일하게, 고정 거래처도 수수료가 켜져 있으면 그대로 적용한다.
                        const fixedClientObj = fixedRouteClient;
                        if (fixedClientObj?.commEnabled) {
                            let fixedComm = 0;
                            if (fixedClientObj.commType === 'percent' || !fixedClientObj.commType) {
                                fixedComm = Math.floor(fAmt * (parseFloat(fixedClientObj.commValue) / 100));
                                clientCommLabels[fixedClientName] = `${fixedClientObj.commValue}%`;
                            } else {
                                fixedComm = parseCurrencyValue(fixedClientObj.commValue) * Math.max(1, record.fixedCount || 0);
                                clientCommLabels[fixedClientName] = `${parseCurrencyValue(fixedClientObj.commValue).toLocaleString()}원`;
                            }
                            monthCommByClient[fixedClientName] = (monthCommByClient[fixedClientName] || 0) + fixedComm;
                            totalCommission += fixedComm;
                        }
                    } else {
                        dayDefaultFare += fAmt;
                    }
                }
                totalMonthDistance += getRecordTotalDistance(record);

                if (record.callDetails && record.callDetails.length > 0) {
                    record.callDetails.forEach(detail => {
                        let type = detail.distanceType || '';
                        if (type === '공차') {
                            // +0
                        } else if (type === '혼짐') {
                            if (detail.linkedLoadIndex === 'pending' || detail.linkedLoadIndex === '-1' || detail.linkedLoadIndex === undefined) {
                                dayWorkCount += 1;
                            }
                        } else {
                            dayWorkCount += 1;
                        }

                        let gross = parseCurrencyValue(detail.fare);
                        let comm = 0;
                        let clientName = detail.client ? detail.client.trim() : '';
                        let isRegisteredClient = false;
                        
                        if (clientName) {
                            const clientObj = savedSettings.clients?.find(c => c.companyName === clientName);
                            if (clientObj) {
                                isRegisteredClient = true;
                            }

                            // 수수료 계산은 저장 시점의 스냅샷을 우선 사용한다(거래처명/수수료율이
                            // 나중에 바뀌어도 이미 저장된 기록의 표시값이 소급 변경되지 않도록).
                            // 스냅샷이 없는(마이그레이션 이전) 과거 기록만 현재 거래처 설정을
                            // 참조하는 기존 방식으로 폴백한다.
                            const commSnapshot = detail.commissionSnapshot;
                            const commEnabled = commSnapshot ? commSnapshot.enabled : !!clientObj?.commEnabled;
                            const commType = commSnapshot ? commSnapshot.type : clientObj?.commType;
                            const commValue = commSnapshot ? commSnapshot.value : clientObj?.commValue;

                            if (commEnabled) {
                                if (commType === 'percent' || !commType) {
                                    comm = Math.floor(gross * (parseFloat(commValue) / 100));
                                    clientCommLabels[clientName] = `${commValue}%`;
                                } else {
                                    comm = parseCurrencyValue(commValue);
                                    clientCommLabels[clientName] = `${comm.toLocaleString()}원`;
                                }
                                monthCommByClient[clientName] = (monthCommByClient[clientName] || 0) + comm;
                            }
                        }

                        if (isRegisteredClient) {
                            monthFareByClient[clientName] = (monthFareByClient[clientName] || 0) + gross;
                        } else {
                            dayDefaultFare += gross;
                        }

                        dayFare += gross;
                        totalCommission += comm;
                    });
                }

                defaultBaseFare += dayDefaultFare;
                const dayPalletFare = dayPalletCount * palletUnitPrice;

                if (dayWorkCount > 0 || dayPalletCount > 0) {
                    totalMonthWork += dayWorkCount;
                    totalFare += dayFare;
                    totalPalletFare += dayPalletFare;

                    workList.push({
                        day: d,
                        isOff: false,
                        workVal: dayWorkCount,
                        palletCount: dayPalletCount,
                        amount: dayFare + dayPalletFare
                    });
                }
            }
        }
    }


    const container = document.getElementById('reportTableContainer');
    container.innerHTML = '';

    if (workList.length === 0) {
        container.innerHTML = `
            <table class="report-table">
                <tbody>
                    <tr><td style="text-align:center; padding: 15px; color: var(--sub-text-color);">해당 월의 운송 내역이 없습니다.</td></tr>
                </tbody>
            </table>`;
    } else if (isForExport) {
        const half = Math.ceil(workList.length / 2);
        const leftList = workList.slice(0, half);
        const rightList = workList.slice(half);

        container.innerHTML = `
            <div class="report-split-container">
                <div class="report-split-column">${createTableHTML(leftList, showPallet)}</div>
                <div class="report-split-column">${rightList.length > 0 ? createTableHTML(rightList, showPallet) : ''}</div>
            </div>`;
    } else {
        container.innerHTML = createTableHTML(workList, showPallet);
    }

    let subCarComm = 0;
    let subCarCommLabel = '기사차량 수수료';
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars?.find(c => c.number === activeLogId);
        if (currentCar?.commEnabled && currentCar.commission) {
            subCarComm = calculateDriverVehicleCommission(currentCar, totalFare + totalPalletFare - totalCommission, totalMonthWork);
            subCarCommLabel = currentCar.commType === 'direct'
                ? `${getShortCarNum(currentCar.number)}차량 건당 ${parseCurrencyValue(currentCar.commission).toLocaleString()}원`
                : `${getShortCarNum(currentCar.number)}차량 ${parseFloat(currentCar.commission) || 0}%`;
        }
    }

    const totalVat = Math.round((totalFare + totalPalletFare) * 0.1);
    const grandTotal = totalFare + totalPalletFare - totalCommission - subCarComm + totalVat;

    const summaryBox = document.querySelector('.report-summary-box');
    
    let baseFareHtml = `
        <div class="summary-row" style="color: var(--primary-color); font-weight: 700; border-bottom: 1px dashed var(--border-color); padding-bottom: 10px; margin-bottom: 10px;">
            <span>월간 총 운행거리</span>
            <span class="summary-value">${totalMonthDistance} km</span>
        </div>
    `;

    if (defaultBaseFare > 0 || Object.keys(monthFareByClient).length === 0) {
        baseFareHtml += `
            <div class="summary-row">
                <span>기본 운송료</span>
                <span class="summary-value">${defaultBaseFare.toLocaleString()} 원</span>
            </div>
        `;
    }
    for (let client in monthFareByClient) {
        baseFareHtml += `
            <div class="summary-row">
                <span>${escapeDetailText(client)} 기본 운송료</span>
                <span class="summary-value">${monthFareByClient[client].toLocaleString()} 원</span>
            </div>
        `;
        if (monthCommByClient[client] > 0) {
            baseFareHtml += `
                <div class="summary-row">
                    <span style="padding-left: 10px; font-size: 0.9rem; color: var(--sub-text-color);">└ ${escapeDetailText(client)} 수수료 (${clientCommLabels[client]})</span>
                    <span class="summary-value">- ${monthCommByClient[client].toLocaleString()} 원</span>
                </div>
            `;
        }
    }
    
    summaryBox.innerHTML = `
        ${baseFareHtml}
        <div class="summary-row">
            <span>부가세 (공급가액 기준 10%)</span>
            <span class="summary-value">${totalVat.toLocaleString()} 원</span>
        </div>
        <div class="summary-row total">
            <span>계</span>
            <span class="summary-value">${grandTotal.toLocaleString()} 원</span>
        </div>
    `;
}

function openDetailReportModal() {
    const clientSelect = document.getElementById('detailReportClientSelect');
    clientSelect.innerHTML = '<option value="ALL">전체 (모두)</option>';
    
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const clientSet = new Set();
    const settings = getUserSettings();
    if (settings.clients) {
        settings.clients.forEach(c => clientSet.add(c.companyName));
    }

    for (let d = 1; d <= lastDate; d++) {
        const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = workData[dateKey];
        if (record && !record.isOff && record.callDetails && record.callDetails.length > 0) {
            record.callDetails.forEach(item => {
                if (item.client) clientSet.add(item.client);
            });
        }
    }
    
    clientSet.forEach(client => {
        const opt = document.createElement('option');
        opt.value = client;
        opt.textContent = client;
        clientSelect.appendChild(opt);
    });
    
    const optUnspecified = document.createElement('option');
    optUnspecified.value = '미지정';
    optUnspecified.textContent = '미지정';
    clientSelect.appendChild(optUnspecified);

    document.getElementById('detailReportSelectModal').classList.remove('hidden');
}

function closeDetailReportModal() {
    document.getElementById('detailReportSelectModal').classList.add('hidden');
}

function createDetailTableHTML(items, isForExport, totalItems, showClientColumn = true) {
    let fontSize = '0.8rem';
    let cellPadding = '10px 4px';
    
    if (isForExport) {
        if (totalItems > 70) {
            fontSize = '0.5rem';
            cellPadding = '2px 1px';
        } else if (totalItems > 45) {
            fontSize = '0.55rem';
            cellPadding = '3px 1px';
        } else if (totalItems > 25) {
            fontSize = '0.65rem';
            cellPadding = '4px 2px';
        } else {
            fontSize = '0.75rem';
            cellPadding = '6px 3px';
        }
    }

    const columnWidths = showClientColumn
        ? { date: '16%', location: '23%', client: '17%', amount: '21%' }
        : { date: '17%', location: '29.5%', amount: '24%' };

    return `
        <table class="report-table detail-report-table" style="font-size: ${fontSize};">
            <thead>
                <tr>
                    <th class="detail-date-cell" style="width: ${columnWidths.date}; padding: ${cellPadding};">날짜</th>
                    <th class="detail-text-cell detail-location-cell" style="width: ${columnWidths.location}; padding: ${cellPadding};">상차지</th>
                    <th class="detail-text-cell detail-location-cell" style="width: ${columnWidths.location}; padding: ${cellPadding};">하차지</th>
                    ${showClientColumn ? `<th class="detail-text-cell" style="width: ${columnWidths.client}; padding: ${cellPadding};">거래처</th>` : ''}
                    <th class="detail-amount-cell" style="width: ${columnWidths.amount}; padding: ${cellPadding};">금액</th>
                </tr>
            </thead>
            <tbody>
                ${items.length > 0 ? items.map(item => `
                    <tr>
                        <td class="detail-date-cell" style="padding: ${cellPadding};">${item.dateStr}</td>
                        <td class="detail-text-cell detail-location-cell" style="padding: ${cellPadding};">${escapeDetailText(item.loadLoc)}</td>
                        <td class="detail-text-cell detail-location-cell" style="padding: ${cellPadding};">${escapeDetailText(item.unloadLoc)}</td>
                        ${showClientColumn ? `<td class="detail-text-cell" style="padding: ${cellPadding};">${escapeDetailText(item.client)}</td>` : ''}
                        <td class="amount detail-amount-cell" style="padding: ${cellPadding};">${item.fare.toLocaleString()}원</td>
                    </tr>
                `).join('') : `<tr><td colspan="${showClientColumn ? 5 : 4}" style="text-align:center; padding: 15px;">해당 내역이 없습니다.</td></tr>`}
            </tbody>
        </table>
    `;
}

function viewDetailReport(isForExport) {
    if (typeof isForExport !== 'boolean') isForExport = false;
    isDetailReportView = true;

    if (!isForExport) {
        const selectEl = document.getElementById('detailReportClientSelect');
        if (selectEl) {
            currentDetailClientFilter = selectEl.value;
        }
    }
    const clientFilter = currentDetailClientFilter;

    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();

    const savedSettings = getUserSettings();
    let detailsList = [];
    let totalFare = 0;
    let totalCommission = 0;

    let defaultBaseFare = 0;
    let monthFareByClient = {};
    let monthCommByClient = {};
    let clientCommLabels = {};

    for (let d = 1; d <= lastDate; d++) {
        const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = workData[dateKey];
        if (record && !record.isOff && record.callDetails && record.callDetails.length > 0) {
            record.callDetails.forEach(item => {
                const clientName = item.client || '미지정';
                if (clientFilter === 'ALL' || clientFilter === clientName) {
                    const fareVal = parseCurrencyValue(item.fare);
                    
                    let comm = 0;
                    let isRegisteredClient = false;

                    if (item.client) {
                        const clientObj = savedSettings.clients?.find(c => c.companyName === item.client);
                        if (clientObj) {
                            isRegisteredClient = true;
                        }

                        // 수수료 계산은 저장 시점의 스냅샷을 우선 사용한다(거래처명/수수료율이
                        // 나중에 바뀌어도 이미 저장된 기록의 표시값이 소급 변경되지 않도록).
                        // 스냅샷이 없는(마이그레이션 이전) 과거 기록만 현재 거래처 설정을
                        // 참조하는 기존 방식으로 폴백한다.
                        const commSnapshot = item.commissionSnapshot;
                        const commEnabled = commSnapshot ? commSnapshot.enabled : !!clientObj?.commEnabled;
                        const commType = commSnapshot ? commSnapshot.type : clientObj?.commType;
                        const commValue = commSnapshot ? commSnapshot.value : clientObj?.commValue;

                        if (commEnabled) {
                            if (commType === 'percent' || !commType) {
                                comm = Math.floor(fareVal * (parseFloat(commValue) / 100));
                                clientCommLabels[clientName] = `${commValue}%`;
                            } else {
                                comm = parseCurrencyValue(commValue);
                                clientCommLabels[clientName] = `${comm.toLocaleString()}원`;
                            }
                            monthCommByClient[clientName] = (monthCommByClient[clientName] || 0) + comm;
                        }
                    }

                    if (isRegisteredClient) {
                        monthFareByClient[clientName] = (monthFareByClient[clientName] || 0) + fareVal;
                    } else {
                        defaultBaseFare += fareVal;
                    }
                    
                    detailsList.push({
                        dateStr: `${currentMonth + 1}월 ${d}일`,
                        loadLoc: item.loadLoc || '-',
                        unloadLoc: item.unloadLoc || '-',
                        client: clientName,
                        fare: fareVal
                    });
                    totalFare += fareVal;
                    totalCommission += comm;
                }
            });
        }
    }

    let tableHTML = '';
    const showClientColumn = clientFilter === 'ALL';

    if (isForExport && detailsList.length > 15) {
        const half = Math.ceil(detailsList.length / 2);
        const leftList = detailsList.slice(0, half);
        const rightList = detailsList.slice(half);

        tableHTML = `
            <div class="report-split-container">
                <div class="report-split-column">${createDetailTableHTML(leftList, true, detailsList.length, showClientColumn)}</div>
                <div class="report-split-column">${rightList.length > 0 ? createDetailTableHTML(rightList, true, detailsList.length, showClientColumn) : ''}</div>
            </div>`;
    } else {
        tableHTML = createDetailTableHTML(detailsList, isForExport, detailsList.length, showClientColumn);
    }

    const clientText = clientFilter === 'ALL' ? '전체' : clientFilter;
    document.getElementById('reportMonthTitle').textContent = `${currentYear}년 ${currentMonth + 1}월 운송비 내역서 (${clientText})`;
    document.getElementById('reportTableContainer').innerHTML = tableHTML;
    
    let subCarComm = 0;
    let subCarCommLabel = '기사차량 수수료';
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars?.find(c => c.number === activeLogId);
        if (currentCar?.commEnabled && currentCar.commission) {
            subCarComm = calculateDriverVehicleCommission(currentCar, totalFare - totalCommission, detailsList.length);
            subCarCommLabel = currentCar.commType === 'direct'
                ? `${getShortCarNum(currentCar.number)}차량 건당 ${parseCurrencyValue(currentCar.commission).toLocaleString()}원`
                : `${getShortCarNum(currentCar.number)}차량 ${parseFloat(currentCar.commission) || 0}%`;
        }
    }

    const vat = Math.round(totalFare * 0.1);
    const grandTotal = totalFare - totalCommission - subCarComm + vat;

    const summaryBox = document.querySelector('.report-summary-box');
    
    let baseFareHtml = '';
    if (defaultBaseFare > 0 || Object.keys(monthFareByClient).length === 0) {
        baseFareHtml += `
            <div class="summary-row">
                <span>기본 운송료</span>
                <span class="summary-value">${defaultBaseFare.toLocaleString()} 원</span>
            </div>
        `;
    }
    for (let client in monthFareByClient) {
        baseFareHtml += `
            <div class="summary-row">
                <span>${escapeDetailText(client)} 기본 운송료</span>
                <span class="summary-value">${monthFareByClient[client].toLocaleString()} 원</span>
            </div>
        `;
        if (monthCommByClient[client] > 0) {
            baseFareHtml += `
                <div class="summary-row">
                    <span style="padding-left: 10px; font-size: 0.9rem; color: var(--sub-text-color);">└ ${escapeDetailText(client)} 수수료 (${clientCommLabels[client]})</span>
                    <span class="summary-value">- ${monthCommByClient[client].toLocaleString()} 원</span>
                </div>
            `;
        }
    }

    summaryBox.innerHTML = `
        ${baseFareHtml}
        <div class="summary-row">
            <span>부가세 (공급가액 기준 10%)</span>
            <span class="summary-value">${vat.toLocaleString()} 원</span>
        </div>
        <div class="summary-row total">
            <span>계</span>
            <span class="summary-value">${grandTotal.toLocaleString()} 원</span>
        </div>
    `;

    if (!isForExport) {
        closeDetailReportModal();
        showToastMessage("세부 내역서가 조회되었습니다.");
    }
}

let editingCarIndex = -1;

function toggleNewLogSettings() {
    const logToggle = document.getElementById('newLogToggle');
    const isChecked = logToggle.checked;
    setSettingsGroupExpanded(document.getElementById('newLogSettings'), isChecked);
}

// 차량 모달의 "기사연동" 상태 문구를 실제 연동 데이터 기준으로 갱신한다.
function updateCarDriverLinkStatusText(existingLink) {
    const el = document.getElementById('carDriverLinkStatusText');
    if (!el) return;
    if (!existingLink) {
        el.textContent = '기사를 초대하고 이 차량에 할당합니다.';
    } else if (existingLink.status === 'linked') {
        el.textContent = `${existingLink.driverName || '기사'}와 연동 중입니다.`;
    } else {
        el.textContent = `${existingLink.driverName || '기사'} 초대가 대기 중입니다(코드 ${existingLink.inviteCode || '-'}).`;
    }
}

// "내 사업자 정보와 동일" 스위치에 따라 차량 사업자정보 입력 필드 묶음을 접고 편다.
function toggleCarBusinessSameAsOwner() {
    const sameAsOwner = document.getElementById('newCarBizSameAsOwner')?.checked ?? true;
    const group = document.getElementById('newCarBizFieldsGroup');
    if (group) group.style.display = sameAsOwner ? 'none' : 'block';
    const preview = document.getElementById('newCarBizSamePreview');
    if (preview && sameAsOwner) {
        const settings = getUserSettings();
        const parts = [settings.bizName, settings.bizNumber].filter(Boolean);
        preview.textContent = parts.length ? parts.join(' · ') : '마이페이지 개인정보에 사업자정보를 먼저 입력해 주세요.';
    }
}

function selectInfoType(type) {
    const btnExisting = document.getElementById('btnUseExistingInfo');
    const btnNew = document.getElementById('btnUseNewInfo');
    const newInfoForm = document.getElementById('newPersonalInfoForm');

    if (type === 'existing') {
        btnExisting.classList.add('active-work');
        btnNew.classList.remove('active-work');
        newInfoForm.style.display = 'none';
    } else {
        btnNew.classList.add('active-work');
        btnExisting.classList.remove('active-work');
        newInfoForm.style.display = 'block';
    }
}

function resetCarForm() {
    document.getElementById('newCarNumber').value = '';
    document.getElementById('newCarTonnage').value = '';
    document.getElementById('carModalMode').value = 'main';
    document.getElementById('driverBasicInfoFields').style.display = 'none';
    document.getElementById('carBusinessInfoFields').style.display = 'none';
    document.getElementById('logToggleContainer').style.display = 'none';
    updateCarDriverLinkStatusText(null);
    document.getElementById('newLogToggle').checked = false;
    toggleNewLogSettings();
    document.getElementById('newCarInsuranceToggle').checked = false;

    if (document.getElementById('newCarCommToggle')) {
        document.getElementById('newCarCommToggle').checked = false;
        toggleNewCarCommSettings();
    }
    setCarCommType('percent');
    document.getElementById('newCarCommission').value = '';

    selectInfoType('existing');
    document.getElementById('newDriverName').value = '';
    document.getElementById('newUserPhone').value = '';
    document.getElementById('newCarSettlementMode').value = 'default';
    document.getElementById('newCarSettlementMode').parentElement?._dropdownSync?.();
    updateDriverSettlementModeGuide();
    document.getElementById('newBankName').value = '';
    document.getElementById('newAccountNumber').value = '';
    if (document.getElementById('newAccountHolder')) document.getElementById('newAccountHolder').value = '';

    // 차량 단위 사업자정보 — 기본값은 "내 사업자 정보와 동일" ON(요구사항 대부분의 기사차량이
    // 차주 사업자 하나로 운영될 것이므로, 매번 새 사업자를 입력해야 하는 부담을 줄인다).
    if (document.getElementById('newCarBizSameAsOwner')) document.getElementById('newCarBizSameAsOwner').checked = true;
    toggleCarBusinessSameAsOwner();
    ['newCarBizName', 'newCarBizNumber', 'newCarBizRepresentative', 'newCarBizAddress', 'newCarBizType', 'newCarBizItem', 'newCarBizEmail']
        .forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
    // 기사 월매출 조회는 기본 ON(기존 차량들이 전부 보이던 것과 동일한 기본 동작 유지).
    if (document.getElementById('newCarShareRevenueToggle')) document.getElementById('newCarShareRevenueToggle').checked = true;

    editingCarIndex = -1;
}

function editCar(idx) {
    const settings = getUserSettings();
    if (!settings.cars || !settings.cars[idx]) return;

    const car = settings.cars[idx];
    editingCarIndex = idx; 
    
    document.getElementById('newCarNumber').value = car.number || '';
    document.getElementById('newCarTonnage').value = car.tonnage || '';
    document.getElementById('carModalMode').value = car.type || 'main';
    
    if (car.type === 'main') {
        document.getElementById('carModalTitle').textContent = '차량 정보 수정';
        document.getElementById('driverBasicInfoFields').style.display = 'none';
        document.getElementById('carBusinessInfoFields').style.display = 'none';
        document.getElementById('logToggleContainer').style.display = 'none';
    } else {
        document.getElementById('carModalTitle').textContent = '기사 정보 수정';
        document.getElementById('driverBasicInfoFields').style.display = 'block';
        document.getElementById('carBusinessInfoFields').style.display = 'block';
        document.getElementById('logToggleContainer').style.display = 'block';
    }
    
    if (car.type === 'sub') {
        const linkedDriver = (settings.driverLinks || []).find(link =>
            (car.driverLinkId && link.id === car.driverLinkId)
            || (!car.driverLinkId && link.vehicleNumber === car.number && link.status !== 'disconnected')
        );
        const driverLinkEnabled = !!car.driverLinkEnabled || (!!linkedDriver && !car.logEnabled);
        document.getElementById('newDriverName').value = car.driverName || linkedDriver?.driverName || car.personalInfo?.driverName || '';
        document.getElementById('newUserPhone').value = car.driverPhone || linkedDriver?.phone || car.personalInfo?.phone || '';
        document.getElementById('newCarSettlementMode').value = car.settlementMode || 'default';
        document.getElementById('newCarSettlementMode').parentElement?._dropdownSync?.();
        updateDriverSettlementModeGuide();
        updateCarDriverLinkStatusText(linkedDriver || null);

        // 차량 단위 사업자정보 — 기존 차량(businessInfo 없음)은 "동일" ON으로 표시한다
        // (getCarBusinessInfo와 동일한 기본값 규칙: 없으면 차주와 동일하게 취급).
        const businessInfo = car.businessInfo;
        const sameAsOwner = !businessInfo || businessInfo.sameAsOwner !== false;
        if (document.getElementById('newCarBizSameAsOwner')) document.getElementById('newCarBizSameAsOwner').checked = sameAsOwner;
        toggleCarBusinessSameAsOwner();
        document.getElementById('newCarBizName').value = !sameAsOwner ? (businessInfo?.name || '') : '';
        document.getElementById('newCarBizNumber').value = !sameAsOwner ? (businessInfo?.bizNumber || '') : '';
        document.getElementById('newCarBizRepresentative').value = !sameAsOwner ? (businessInfo?.representative || '') : '';
        document.getElementById('newCarBizAddress').value = !sameAsOwner ? (businessInfo?.address || '') : '';
        document.getElementById('newCarBizType').value = !sameAsOwner ? (businessInfo?.bizType || '') : '';
        document.getElementById('newCarBizItem').value = !sameAsOwner ? (businessInfo?.bizItem || '') : '';
        document.getElementById('newCarBizEmail').value = !sameAsOwner ? (businessInfo?.email || '') : '';

        // 기사 월매출 조회 — 값이 아예 없는 기존 차량은 기본 ON(이전까지 항상 보이던 것과 동일).
        if (document.getElementById('newCarShareRevenueToggle')) {
            document.getElementById('newCarShareRevenueToggle').checked = isVehicleRevenueSharedWithOwner(car);
        }

        document.getElementById('newCarInsuranceToggle').checked = !!car.insuranceOn;
        
        if (document.getElementById('newCarCommToggle')) {
            document.getElementById('newCarCommToggle').checked = !!car.commEnabled;
            toggleNewCarCommSettings();
        }
        setCarCommType(car.commType || 'percent');
        document.getElementById('newCarCommission').value = car.commission || '';

        if (car.logEnabled && !driverLinkEnabled) {
            document.getElementById('newLogToggle').checked = true;
            toggleNewLogSettings();
            if (car.infoType === 'new') {
                selectInfoType('new');
                if (car.personalInfo) {
                    document.getElementById('newBankName').value = car.personalInfo.bank || '';
                    document.getElementById('newAccountNumber').value = car.personalInfo.account || '';
                    if (document.getElementById('newAccountHolder')) document.getElementById('newAccountHolder').value = car.personalInfo.accountHolder || '';
                }
            } else {
                selectInfoType('existing');
            }
        } else {
            document.getElementById('newLogToggle').checked = false;
            toggleNewLogSettings();
            selectInfoType('existing');
        }
    }

    document.getElementById('carModal').classList.remove('hidden');
}

// 앱 초기화 구문
normalizeLegacyData();
normalizeLegacyClientIds();
normalizeLegacyPinnedLocations();
try {
    syncNormalizedEntityStore();
} catch (error) {
    console.error('정규화 데이터 초기화 실패:', error);
}
loadSettings();
initDateSelects();
initMaintDateSelects();
initFuelDateSelects();
initMiscDateSelects();
initRevenueDateSelects();
initCalendarDOM();
buildCalendar();
renderSubCarMenu();
updateAccountRoleUI();
checkBackupReminder();

// 스플래시 화면(시작 화면) 제어 로직
// 이미 로그인된 재방문 유저는 매번 2초씩 기다릴 필요가 없으므로 대기 없이 짧게 페이드아웃하고,
// 최초 진입(계정 유형 미선택/로그인 전) 유저에게만 기존 브랜딩 노출 시간을 유지한다.
window.addEventListener('load', () => {
    const splashScreen = document.getElementById('splashScreen');
    if (!splashScreen) return;

    (async () => {
        // Supabase 세션이 실제로 남아있는지 먼저 확인하고, 로컬의 isLoggedIn 플래그를
        // 그 결과에 맞게 보정한다(다른 기기에서 로그아웃했거나 세션이 만료된 경우 등 대비).
        let hasSupabaseSession = false;
        if (typeof getSupabaseUser === 'function') {
            try {
                hasSupabaseSession = !!(await getSupabaseUser());
            } catch (error) {
                console.error('Supabase 세션 확인 실패(로컬 상태로 계속 진행):', error);
            }
        }

        let settings = getUserSettings();
        // 주의: 여기서는 반드시 setUserSettings()가 아니라 localStorage에 직접 써야 한다.
        // setUserSettings()는 호출될 때마다 600ms 뒤 "지금 로컬 settings 전체"를 그대로
        // Supabase profiles에 업로드(동기화)한다. 이 시점은 바로 아래 hydrateFromSupabaseAndMigrate()가
        // 서버 데이터를 아직 불러오기도 전이라, 새 기기/브라우저처럼 로컬 userSettings가 비어있는
        // 상태일 수 있다 — 그 "빈 상태"로 배경 동기화가 hydrate보다 먼저 끝나버리면(네트워크 상황에
        // 따라 실제로 이렇게 됨) 서버에 이미 저장돼 있던 accountType/사업자정보/계좌정보 등이
        // 통째로 null로 덮어써지는 심각한 데이터 유실 버그가 있었다(실제 계정에서 재현 확인됨).
        // isLoggedIn 플래그는 로컬에만 즉시 반영하고, 서버 동기화는 트리거하지 않는다 — 실제
        // 서버 동기화는 hydrate가 끝난 뒤 사용자가 무언가 저장할 때 정상적인 최신 데이터로 일어난다.
        if (hasSupabaseSession && !settings.isLoggedIn) {
            settings.isLoggedIn = true;
            settings.onboardingCompleted = true;
            localStorage.setItem('userSettings', JSON.stringify(settings));
        } else if (!hasSupabaseSession && settings.isLoggedIn) {
            settings.isLoggedIn = false;
            localStorage.setItem('userSettings', JSON.stringify(settings));
        }
        settings = getUserSettings();

        if (hasSupabaseSession && typeof hydrateFromSupabaseAndMigrate === 'function') {
            try {
                await hydrateFromSupabaseAndMigrate();
                settings = getUserSettings();
            } catch (error) {
                console.error('Supabase 초기 동기화 실패(로컬 데이터로 계속 진행):', error);
            }
        }

        const isReturningUser = !!settings.isLoggedIn;
        const holdMs = isReturningUser ? 0 : 1500;
        const fadeMs = isReturningUser ? 200 : 500;

        setTimeout(() => {
            splashScreen.style.transition = `opacity ${fadeMs}ms ease`;
            splashScreen.style.opacity = '0';

            setTimeout(() => {
                splashScreen.style.display = 'none';

                // guestMode(비회원으로 시작하기)를 선택한 사용자는 isLoggedIn이 계속 false라도
                // 새로고침할 때마다 로그인 화면으로 돌려보내지 않는다 — 그러면 "비회원으로
                // 시작하기"가 사실상 매번 다시 눌러야 하는 무의미한 버튼이 된다.
                if (!settings.isLoggedIn && !settings.guestMode) {
                    // 아직 로그인 전(로그인/회원가입 선택 화면으로 보내지는 상태)이다 — 이
                    // 시점의 로컬 백업 이력(lastBackupAt)은 항상 비어있으므로(브라우저에
                    // 저장된 적 없는 완전 신규 방문자 포함) getBackupNotificationItem()이
                    // 무조건 "백업이 필요하다"고 판단해, 계정도 없고 데이터도 하나 없는
                    // 사용자에게 로그인 화면이 뜨자마자 "데이터 백업을 권장합니다" 토스트가
                    // 뜨는 결함이 있었다(실제로 재현됨). 실제로 지킬 데이터가 있는 로그인/
                    // 비회원 사용자에게만 안내하도록, 로그인 화면으로 보낼 때는 이 안내를
                    // 건너뛴다.
                    showLocalLoginPage();
                } else if (settings.guestMode) {
                    showMain(true);
                    updateOverdueNotification(true);
                } else {
                    updateOverdueNotification(true);
                }
            }, fadeMs);
        }, holdMs);
    })();
});

function handleLogin() {
    showLocalLoginPage();
}

function handleLogout() {
    showConfirmModal('로그아웃하시겠습니까? 기기에 저장된 기록은 유지됩니다.', () => {
        const settings = getUserSettings();
        settings.isLoggedIn = false;
        setUserSettings(settings);
        updateAccountRoleUI();
        showLocalLoginPage();
        if (typeof supabaseSignOutSafely === 'function') supabaseSignOutSafely();
    });
}

// 운행 일지 카드의 미수/수금 빠른 토글. payments 원장을 기준으로 동작하도록 맞춰서
// 미수금 관리 화면(부분입금 포함)과 상태가 어긋나지 않게 한다.
function toggleCallPaymentStatus(index) {
    if (index < 0 || !currentTempCallDetails[index]) return;

    const detail = currentTempCallDetails[index];
    const summary = getDetailPaymentSummary(detail);

    if (!Array.isArray(detail.payments)) detail.payments = [];

    if (summary.status === 'paid') {
        // 완전 취소: 이 카드에서 쌓인 입금 기록을 전부 초기화
        detail.payments = [];
    } else {
        // 빠른 전액 수금 처리: 남은 금액을 한 건의 결제로 등록
        const fare = parseCurrencyValue(detail.fare);
        const remaining = Math.max(fare - summary.paidAmount, 0);
        if (remaining > 0) {
            detail.payments.push({ id: generateLocalId('pay'), amount: remaining, paidAt: new Date().toISOString(), note: '' });
        }
    }
    syncDetailPaymentStatus(detail);

    // UI 즉시 업데이트
    renderCallDetailSummaryInMainModal();
    if (!document.getElementById('workModal').classList.contains('hidden')) {
        autoSaveWorkRecord();
    }
}

function openTodayWorkModal() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    const dateKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
    openModal(dateKey, currentMonth, currentDay);
}

function formatDateToYmd(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getPaymentTermLabel(term, value) {
    if (term === 'next_month_end') return '익월 말일 정산';
    if (term === 'second_month_end') return '익익월 말일 정산';
    if (term === 'next_month_day') return `익월 ${value || ''}일 정산`;
    if (term === 'second_month_day') return `익익월 ${value || ''}일 정산`;
    if (term === 'after_days') return `운행 건별 ${value || ''}일 후 정산`;
    return '당일·수시 정산';
}

function calculatePaymentDueDate(workDate, paymentTerm, paymentTermValue) {
    const date = new Date(`${workDate}T00:00:00`);

    if (paymentTerm === 'next_month_end') {
        return formatDateToYmd(new Date(date.getFullYear(), date.getMonth() + 2, 0));
    }

    if (paymentTerm === 'second_month_end') {
        return formatDateToYmd(new Date(date.getFullYear(), date.getMonth() + 3, 0));
    }

    if (paymentTerm === 'second_month_day') {
        const selectedDay = Math.max(1, Math.min(31, parseInt(paymentTermValue, 10) || 1));
        const secondMonthLastDay = new Date(date.getFullYear(), date.getMonth() + 3, 0).getDate();
        return formatDateToYmd(new Date(date.getFullYear(), date.getMonth() + 2, Math.min(selectedDay, secondMonthLastDay)));
    }

    if (paymentTerm === 'next_month_day') {
        const selectedDay = Math.max(1, Math.min(31, parseInt(paymentTermValue, 10) || 1));
        const nextMonthLastDay = new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate();
        return formatDateToYmd(new Date(date.getFullYear(), date.getMonth() + 1, Math.min(selectedDay, nextMonthLastDay)));
    }

    if (paymentTerm === 'after_days') {
        const days = Math.max(0, parseInt(paymentTermValue, 10) || 0);
        date.setDate(date.getDate() + days);
        return formatDateToYmd(date);
    }

    return formatDateToYmd(date);
}

function updateClientPaymentTermControls() {
    const term = document.getElementById('clientPaymentTerm').value;
    const valueWrap = document.getElementById('clientPaymentTermValueWrap');
    const valueLabel = document.getElementById('clientPaymentTermValueLabel');
    const valueInput = document.getElementById('clientPaymentTermValue');
    // 결제 주기 유형이 바뀌면 이전 유형 기준으로 표시됐던 인라인 오류는 더 이상 유효하지
    // 않으므로 함께 지운다.
    clearFieldError(valueInput);

    if (term === 'next_month_day' || term === 'second_month_day') {
        valueWrap.style.display = 'block';
        valueLabel.textContent = term === 'next_month_day' ? '익월 입금일' : '익익월 입금일';
        valueInput.min = '1';
        valueInput.max = '31';
        valueInput.placeholder = '1~31';
    } else if (term === 'after_days') {
        valueWrap.style.display = 'block';
        valueLabel.textContent = '운행 후 경과일';
        valueInput.min = '0';
        valueInput.max = '';
        valueInput.placeholder = '예: 30';
    } else {
        valueWrap.style.display = 'none';
        valueInput.value = '';
    }
}

function updateClientPaymentTermGuide() {
    const term = document.getElementById('clientPaymentTerm').value;
    const value = document.getElementById('clientPaymentTermValue').value;
    const guide = document.getElementById('clientPaymentTermGuide');
    const exampleWorkDate = '2026-07-15';
    const dueDate = calculatePaymentDueDate(exampleWorkDate, term, value);

    if ((term === 'next_month_day' || term === 'second_month_day') && !value) {
        guide.textContent = '입금일을 1일부터 31일 사이에서 입력해 주세요.';
        return;
    }

    if (term === 'after_days' && value === '') {
        guide.textContent = '운행 후 며칠 뒤 입금되는지 입력해 주세요.';
        return;
    }

    guide.textContent = `예시: 2026.07.15 운행 · ${getPaymentTermLabel(term, value)} → ${dueDate.replace(/-/g, '.')} 입금 예정`;
}

function applyClientPaymentTerms() {
    const clientName = document.getElementById('callClient').value.trim();
    const dueDateInput = document.getElementById('callPaymentDueDate');
    const guide = document.getElementById('callPaymentDueGuide');
    const editIndex = parseInt(document.getElementById('callDetailEditIndex').value, 10);
    const settings = getUserSettings();
    const client = (settings.clients || []).find(item => item.companyName === clientName);

    if (!client) {
        guide.textContent = '등록된 거래처를 선택하면 결제 조건에 맞춰 자동 입력됩니다.';
        if (editIndex < 0) dueDateInput.value = '';
        return;
    }

    const term = client.paymentTerm || 'next_month_end';
    const value = client.paymentTermValue || '';

    if (editIndex >= 0 && currentTempCallDetails[editIndex] && currentTempCallDetails[editIndex].paymentDueDate) {
        dueDateInput.value = currentTempCallDetails[editIndex].paymentDueDate;
    } else {
        dueDateInput.value = calculatePaymentDueDate(selectedDateKey, term, value);
    }

    guide.textContent = `${getPaymentTermLabel(term, value)} 조건이 적용되었습니다. 필요하면 입금 예정일을 직접 수정할 수 있습니다.`;
}

function showReceivablesManagement(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('receivablesManagementPage').classList.remove('hidden');
    selectReceivableTab('monthly');
}

function selectReceivableTab(tab) {
    document.getElementById('receivableMonthlyTab').classList.toggle('active', tab === 'monthly');
    document.getElementById('receivableDueTab').classList.toggle('active', tab === 'due');
    renderReceivablesManagement(tab);
}

let currentReceivableTab = 'monthly';
let currentReceivableDetail = null;

// ========== 월매출 화면 ==========
let currentRevenueTab = 'monthly'; // 'monthly' | 'yearly'
let revenueViewYear = new Date().getFullYear();
let revenueViewMonth = new Date().getMonth(); // 0-11, yearSelect/monthSelect 관례와 동일

function initRevenueDateSelects() {
    populateYearMonthSelects('revenueYearSelect', 'revenueMonthSelect');
}

function showRevenuePage(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('revenuePage').classList.remove('hidden');
    selectRevenueTab('monthly');
    setActiveNav('revenue');
}

function selectRevenueTab(tab) {
    currentRevenueTab = tab === 'yearly' ? 'yearly' : 'monthly';
    document.getElementById('revenueYearlyTab')?.classList.toggle('active', currentRevenueTab === 'yearly');
    document.getElementById('revenueMonthlyTab')?.classList.toggle('active', currentRevenueTab === 'monthly');
    syncRevenueDateSelects();
    renderRevenuePage();
}

// 화살표 버튼: 월매출 탭에서는 한 달씩, 년매출 탭에서는 한 해씩 이동한다.
function changeRevenueDate(delta) {
    if (currentRevenueTab === 'yearly') {
        revenueViewYear += delta;
    } else {
        revenueViewMonth += delta;
        if (revenueViewMonth < 0) { revenueViewMonth = 11; revenueViewYear -= 1; }
        else if (revenueViewMonth > 11) { revenueViewMonth = 0; revenueViewYear += 1; }
    }
    syncRevenueDateSelects();
    renderRevenuePage();
}

function changeRevenueYearMonth() {
    const yearSelect = document.getElementById('revenueYearSelect');
    const monthSelect = document.getElementById('revenueMonthSelect');
    if (yearSelect) revenueViewYear = parseInt(yearSelect.value, 10);
    if (currentRevenueTab === 'monthly' && monthSelect) revenueViewMonth = parseInt(monthSelect.value, 10);
    renderRevenuePage();
}

// 선택값/화살표 타이틀/월 선택 노출 여부를 현재 탭·연·월 상태에 맞춰 동기화한다.
function syncRevenueDateSelects() {
    const yearSelect = document.getElementById('revenueYearSelect');
    const monthSelect = document.getElementById('revenueMonthSelect');
    if (!yearSelect || !monthSelect) return;

    yearSelect.value = revenueViewYear;
    monthSelect.value = revenueViewMonth;
    yearSelect.parentElement?._dropdownSync?.();
    monthSelect.parentElement?._dropdownSync?.();

    // 년매출 탭에서는 월 선택이 의미가 없으므로 숨긴다.
    if (monthSelect.parentElement) monthSelect.parentElement.style.display = currentRevenueTab === 'yearly' ? 'none' : '';

    const prevBtn = document.getElementById('revenuePrevBtn');
    const nextBtn = document.getElementById('revenueNextBtn');
    const label = currentRevenueTab === 'yearly' ? '해' : '달';
    if (prevBtn) prevBtn.title = `이전 ${label}`;
    if (nextBtn) nextBtn.title = `다음 ${label}`;
}

function renderRevenuePage() {
    if (currentRevenueTab === 'yearly') renderRevenueYearly();
    else renderRevenueMonthly();
}

function renderRevenueMonthly() {
    const container = document.getElementById('revenueResultContainer');
    if (!container) return;

    const monthKey = `${revenueViewYear}-${String(revenueViewMonth + 1).padStart(2, '0')}`;
    const result = getMonthlyFareRevenue(monthKey);

    const vehicleRowsHtml = result.byVehicle.length > 1 ? `
        <div class="revenue-vehicle-list">
            ${result.byVehicle.map(vehicle => `
                <div class="revenue-vehicle-row">
                    <span>${escapeDetailText(vehicle.label)}</span>
                    <span>${vehicle.fare.toLocaleString()}원</span>
                </div>
            `).join('')}
        </div>
    ` : '';

    container.innerHTML = `
        <div class="revenue-summary-card">
            <div class="revenue-summary-total">
                <span>${revenueViewYear}년 ${revenueViewMonth + 1}월 총 운송료</span>
                <strong>${result.totalFare.toLocaleString()}원</strong>
            </div>
            <div class="revenue-summary-count">총 ${result.tripCount}회 운행</div>
        </div>
        ${vehicleRowsHtml}
    `;
}

function renderRevenueYearly() {
    const container = document.getElementById('revenueResultContainer');
    if (!container) return;

    let yearTotal = 0;
    const rows = [];
    for (let month = 0; month < 12; month++) {
        const monthKey = `${revenueViewYear}-${String(month + 1).padStart(2, '0')}`;
        const result = getMonthlyFareRevenue(monthKey);
        yearTotal += result.totalFare;
        rows.push({ month: month + 1, fare: result.totalFare });
    }

    container.innerHTML = `
        <div class="revenue-year-list">
            ${rows.map(row => `
                <div class="revenue-year-row">
                    <span>${row.month}월</span>
                    <span>${row.fare.toLocaleString()}원</span>
                </div>
            `).join('')}
        </div>
        <div class="revenue-year-total">
            <span>${revenueViewYear}년 합계</span>
            <strong>${yearTotal.toLocaleString()}원</strong>
        </div>
    `;
}

// 결제 상태 계산: detail.payments 배열(부분입금 이력)을 기준으로 입금액/잔액/상태를 도출한다.
// payments 배열이 없는 예전 기록은 detail.paymentStatus만으로 하위호환 변환한다.
function getDetailPaymentSummary(detail) {
    const fare = parseCurrencyValue(detail?.fare);

    if (!Array.isArray(detail?.payments)) {
        const legacyPaid = (detail?.paymentStatus || '미수') !== '미수';
        return {
            paidAmount: legacyPaid ? fare : 0,
            remainingAmount: legacyPaid ? 0 : fare,
            status: legacyPaid ? 'paid' : 'unpaid' // 'unpaid' | 'partial' | 'paid'
        };
    }

    const paidAmount = detail.payments.reduce((sum, payment) => sum + (parseCurrencyValue(payment.amount) || 0), 0);
    const remainingAmount = Math.max(fare - paidAmount, 0);
    let status = 'unpaid';
    if (paidAmount > 0 && remainingAmount > 0) status = 'partial';
    else if (paidAmount > 0 && remainingAmount <= 0) status = 'paid';

    return { paidAmount, remainingAmount, status };
}

// payments 배열을 바꾼 뒤에는 항상 호출: 레거시 paymentStatus('미수'/'수금 완료') 필드를
// 새 상태와 계속 동기화해 다른 화면이 paymentStatus만 봐도 완료 여부가 어긋나지 않게 한다.
function syncDetailPaymentStatus(detail) {
    const summary = getDetailPaymentSummary(detail);
    detail.paymentStatus = summary.status === 'paid' ? '수금 완료' : '미수';
    return summary;
}

// 지금 열려 있는 차량 로그 하나가 아니라, 세금계산서 집계(getTaxInvoiceSourceGroups)와 동일한
// 방식으로 메인 + 모든 서브 차량의 운행 기록을 합산해서 미수금 항목을 만든다.
// - 메인/서브는 각각 paymentOn(메인)·subPaymentOn(서브, 모든 서브 차량이 공유하는 설정)이
//   켜져 있을 때만 포함한다.
// - 기사 직접 정산(driver_direct) 차량은 그 매출이 회사(내 장부) 몫이 아니므로 세금계산서
//   집계와 동일하게 제외한다.
// - 각 항목에는 어느 로그에서 나왔는지 구분할 수 있도록 logId('main' 또는 차량번호)와
//   화면 표시용 logLabel을 함께 담는다.
function getReceivableItems() {
    const settings = getUserSettings();
    const cars = settings.cars || [];

    const sources = [];
    if (settings.paymentOn) {
        sources.push({ logId: 'main', logLabel: '메인 차량', data: readWorkDataStorage('workData') });
    }
    if (settings.subPaymentOn) {
        cars.filter(car => car.type === 'sub').forEach(car => {
            const mode = getEffectiveDriverSettlementMode(car, settings);
            if (mode === 'company' || mode === 'employee') {
                sources.push({ logId: car.number, logLabel: getShortCarNum(car.number), data: getDriverCarWorkData(car, settings) });
            }
        });
    }

    const items = [];

    sources.forEach(source => {
        Object.keys(source.data || {}).forEach(dateKey => {
            const record = source.data[dateKey];

            if (!record || record.isOff || !record.callDetails) {
                return;
            }

            record.callDetails.forEach((detail, detailIndex) => {
                const paymentSummary = getDetailPaymentSummary(detail);
                if (paymentSummary.status === 'paid') {
                    return;
                }

                items.push({
                    dateKey,
                    detailIndex,
                    logId: source.logId,
                    logLabel: source.logLabel,
                    client: detail.client || '미지정 거래처',
                    fare: parseCurrencyValue(detail.fare),
                    paidAmount: paymentSummary.paidAmount,
                    remainingAmount: paymentSummary.remainingAmount,
                    paymentSummaryStatus: paymentSummary.status,
                    payments: Array.isArray(detail.payments) ? detail.payments : [],
                    paymentDueDate: detail.paymentDueDate || '',
                    workDate: detail.workDate || dateKey,
                    loadLoc: detail.loadLoc || '',
                    unloadLoc: detail.unloadLoc || '',
                    remarks: detail.remarks || ''
                });
            });
        });
    });

    return items;
}

function getOverdueReceivableItems() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return getReceivableItems().filter(item => {
        if (!item.paymentDueDate) return false;
        const dueDate = new Date(`${item.paymentDueDate}T00:00:00`);
        return !Number.isNaN(dueDate.getTime()) && dueDate < today;
    });
}

// 어느 차량(logId)의 기록인지까지 포함해야 차량마다 알림 무시 여부가 올바르게 구분된다.
function getNotificationItemKey(item) {
    return `${item.logId}|${item.dateKey}|${item.detailIndex}|${item.paymentDueDate}`;
}

function getDismissedNotificationKeys() {
    try {
        const keys = JSON.parse(localStorage.getItem('dismissedReceivableNotifications') || '[]');
        return new Set(Array.isArray(keys) ? keys : []);
    } catch (error) {
        return new Set();
    }
}

function getVisibleOverdueNotifications() {
    const dismissed = getDismissedNotificationKeys();
    return getOverdueReceivableItems().filter(item => !dismissed.has(getNotificationItemKey(item)));
}

async function updateOverdueNotification(announce = false) {
    const overdueItems = getVisibleOverdueNotifications();
    const backupItem = await getBackupNotificationItem();
    const employerLinkItem = getEmployerLinkNotificationItem();
    const todayLogReminderItem = getTodayLogReminderNotificationItem();
    const totalCount = overdueItems.length + (backupItem ? 1 : 0) + (employerLinkItem ? 1 : 0) + (todayLogReminderItem ? 1 : 0);

    const badge = document.getElementById('overdueNotificationBadge');
    const notificationButton = document.getElementById('notificationBtn');
    if (!badge || !notificationButton) return;

    badge.hidden = totalCount === 0;
    badge.textContent = totalCount > 99 ? '99+' : String(totalCount);
    const label = totalCount > 0 ? `확인 필요한 알림 ${totalCount}건` : '새로운 알림 없음';
    notificationButton.title = label;
    notificationButton.setAttribute('aria-label', label);

    if (!announce || totalCount === 0) return;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const signature = overdueItems
        .map(item => `${item.logId}:${item.dateKey}:${item.detailIndex}:${item.paymentDueDate}`)
        .sort()
        .join('|');
    // 이제 여러 차량 로그를 합산한 결과이므로 activeLogId로 더 이상 범위를 좁히지 않는다
    // (그러면 로그를 전환할 때마다 같은 연체 알림 토스트가 다시 뜨게 된다). 백업/기사연동
    // 알림 유무도 시그니처에 포함해서, 연체 미수금은 그대로인데 이 둘만 새로 생긴/사라진
    // 경우에도 토스트가 다시 안내되게 한다.
    const signatureWithBackup = `${signature}|backup:${backupItem ? backupItem.key : '0'}|employerLink:${employerLinkItem ? employerLinkItem.key : '0'}|todayLog:${todayLogReminderItem ? todayLogReminderItem.key : '0'}`;
    const alertKey = `${todayKey}|${signatureWithBackup}`;
    if (localStorage.getItem('lastOverdueReceivableAlert') === alertKey) return;

    localStorage.setItem('lastOverdueReceivableAlert', alertKey);
    // 기사연동 안내는 토스트로 스쳐 지나가지 않고 알림 패널(뱃지 카운트)에만 남겨둔다 — 여기서는
    // 의도적으로 토스트를 띄우지 않는다. 연체 미수금/백업 안내는 기존과 동일하게 유지한다.
    if (overdueItems.length > 0) {
        const total = overdueItems.reduce((sum, item) => sum + item.remainingAmount, 0);
        showToastMessage(`연체 미수금 ${overdueItems.length}건 · ${total.toLocaleString()}원이 있습니다.`);
    } else if (backupItem) {
        showToastMessage('데이터 백업을 권장합니다. 알림 메뉴를 확인해 주세요.');
    }
}

async function renderNotificationPanel() {
    const container = document.getElementById('notificationPanelList');
    if (!container) return;

    const overdueItems = getVisibleOverdueNotifications()
        .sort((a, b) => a.paymentDueDate.localeCompare(b.paymentDueDate));
    const backupItem = await getBackupNotificationItem();
    const employerLinkItem = getEmployerLinkNotificationItem();
    const todayLogReminderItem = getTodayLogReminderNotificationItem();

    if (overdueItems.length === 0 && !backupItem && !employerLinkItem && !todayLogReminderItem) {
        container.innerHTML = '<div class="notification-panel-empty">현재 확인이 필요한 알림이 없습니다.</div>';
        return;
    }

    // 서브 차량이 하나도 없는(메인만 쓰는) 계정에는 차량 구분 배지를 아예 노출하지 않는다.
    const hasSubCars = (getUserSettings().cars || []).some(car => car.type === 'sub');
    let html = '';

    // 오늘자 미입력 안내도 다른 안내처럼 카드 전체가 클릭되는 형태로 보여준다 — 누르면 바로
    // 오늘 날짜의 일일운행 입력 화면으로 이동한다(openTodayWorkModal 재사용).
    if (todayLogReminderItem) {
        html += `
            <div class="notification-swipe-shell" data-notification-key="${escapeDetailText(todayLogReminderItem.key)}">
                <div class="notification-delete-backdrop" aria-hidden="true"><span>삭제</span><span>삭제</span></div>
                <button type="button" class="notification-panel-item" onclick="handleTodayLogReminderNotificationClick(event)">
                    <div class="notification-panel-item-head">
                        <strong style="color: var(--primary-color);">${escapeDetailText(todayLogReminderItem.title)}</strong>
                        <span>${escapeDetailText(todayLogReminderItem.actionLabel)} &gt;</span>
                    </div>
                    <p class="notification-panel-item-message">${escapeDetailText(todayLogReminderItem.message)}</p>
                </button>
            </div>
        `;
    }

    // 기사연동 안내는 다른 기능(운행기록 조회 등)이 전부 이 연동을 전제로 하므로 맨 위,
    // 카드 전체가 클릭되는 형태로 보여준다 — 누르면 바로 연동 화면(개인정보의 소속 연결
    // 카드)으로 이동한다.
    if (employerLinkItem) {
        html += `
            <div class="notification-swipe-shell" data-notification-key="${escapeDetailText(employerLinkItem.key)}">
                <div class="notification-delete-backdrop" aria-hidden="true"><span>삭제</span><span>삭제</span></div>
                <button type="button" class="notification-panel-item" onclick="handleEmployerLinkNotificationClick(event)">
                    <div class="notification-panel-item-head">
                        <strong style="color: var(--primary-color);">${escapeDetailText(employerLinkItem.title)}</strong>
                        <span>${escapeDetailText(employerLinkItem.actionLabel)} &gt;</span>
                    </div>
                    <p class="notification-panel-item-message">${escapeDetailText(employerLinkItem.message)}</p>
                </button>
            </div>
        `;
    }

    // 백업 알림은 전용 카드로 렌더링한다("지금 백업" 버튼은 목록 클릭(연체 미수금
    // 이동)과 별개로 즉시 exportData()를 실행해야 하므로 stopPropagation으로 분리한다).
    if (backupItem) {
        html += `
            <div class="notification-swipe-shell" data-notification-key="${escapeDetailText(backupItem.key)}">
                <div class="notification-delete-backdrop" aria-hidden="true"><span>삭제</span><span>삭제</span></div>
                <div class="notification-panel-item backup-notification-item">
                    <div class="notification-panel-item-head">
                        <strong style="color: var(--primary-color);">${escapeDetailText(backupItem.title)}</strong>
                        <button type="button" class="backup-quick-btn" onclick="event.stopPropagation(); runSaveAction(this, 'backup-export', exportData);">${escapeDetailText(backupItem.actionLabel)}</button>
                    </div>
                    <p class="notification-panel-item-message">${escapeDetailText(backupItem.message)}</p>
                    <div class="notification-panel-item-meta">
                        <span>${escapeDetailText(backupItem.metaText)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    html += overdueItems.map(item => `
        <div class="notification-swipe-shell" data-notification-key="${escapeDetailText(getNotificationItemKey(item))}">
            <div class="notification-delete-backdrop" aria-hidden="true"><span>삭제</span><span>삭제</span></div>
            <button type="button" class="notification-panel-item" onclick="handleNotificationItemClick(event)">
                <div class="notification-panel-item-head">
                    <strong>${escapeDetailText(item.client)}</strong>
                    <span>${getDdayText(item.paymentDueDate)}</span>
                </div>
                ${hasSubCars ? `<div class="notification-panel-item-car"><span class="management-badge car-type${item.logId === 'main' ? ' main' : ''}">${escapeDetailText(item.logLabel)}</span></div>` : ''}
                <p class="notification-panel-item-message">입금 예정일이 지난 미수금입니다. 정산 내역을 확인해 주세요.</p>
                <div class="notification-panel-item-meta">
                    <span>입금 예정일 ${item.paymentDueDate.replace(/-/g, '.')}</span>
                    <b>${item.remainingAmount.toLocaleString()}원</b>
                </div>
            </button>
        </div>
    `).join('');

    container.innerHTML = html;
    initNotificationSwipeInteractions();
}

function handleNotificationItemClick(event) {
    const shell = event.currentTarget.closest('.notification-swipe-shell');
    if (shell?.dataset.suppressClick === 'true') {
        event.preventDefault();
        shell.dataset.suppressClick = 'false';
        return;
    }
    openNotificationReceivables();
}

// 알림 패널의 "사장님과 연결이 필요해요" 카드 클릭 — 패널을 닫고 바로 연동 화면으로
// 이동한다. showDriverConnectionManagement()는 이미 소속 기사 계정이면 개인정보 페이지의
// "소속 연결" 카드로 자동 안내해 주므로 그대로 재사용한다.
function handleEmployerLinkNotificationClick(event) {
    const shell = event.currentTarget.closest('.notification-swipe-shell');
    if (shell?.dataset.suppressClick === 'true') {
        event.preventDefault();
        shell.dataset.suppressClick = 'false';
        return;
    }
    closeNotificationPanel();
    showDriverConnectionManagement('main');
}

// 알림 패널의 "오늘 운행 아직 안 적으셨어요" 카드 클릭 — 패널을 닫고 바로 오늘 날짜의
// 일일운행 입력 화면으로 이동한다.
function handleTodayLogReminderNotificationClick(event) {
    const shell = event.currentTarget.closest('.notification-swipe-shell');
    if (shell?.dataset.suppressClick === 'true') {
        event.preventDefault();
        shell.dataset.suppressClick = 'false';
        return;
    }
    closeNotificationPanel();
    openTodayWorkModal();
}

function dismissNotification(shell) {
    const key = shell.dataset.notificationKey;
    const dismissed = getDismissedNotificationKeys();
    dismissed.add(key);
    localStorage.setItem('dismissedReceivableNotifications', JSON.stringify([...dismissed]));

    const item = shell.querySelector('.notification-panel-item');
    const direction = Number(shell.dataset.swipeDirection || -1);
    item.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1), opacity .18s ease';
    item.style.transform = `translateX(${direction * window.innerWidth}px)`;
    item.style.opacity = '0';

    setTimeout(() => {
        shell.style.height = `${shell.offsetHeight}px`;
        requestAnimationFrame(() => {
            shell.classList.add('removing');
            shell.style.height = '0px';
        });
    }, 170);

    setTimeout(() => {
        shell.remove();
        const list = document.getElementById('notificationPanelList');
        if (list && !list.querySelector('.notification-swipe-shell')) {
            list.innerHTML = '<div class="notification-panel-empty">현재 확인이 필요한 알림이 없습니다.</div>';
        }
    }, 430);

    updateOverdueNotification(false);
}

function initNotificationSwipeInteractions() {
    document.querySelectorAll('#notificationPanelList .notification-swipe-shell').forEach(shell => {
        const item = shell.querySelector('.notification-panel-item');
        let holdTimer = null;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let isHolding = false;
        let isSwiping = false;

        const reset = () => {
            clearTimeout(holdTimer);
            isHolding = false;
            isSwiping = false;
            offsetX = 0;
            shell.classList.remove('swiping', 'swipe-ready');
            item.style.transform = '';
        };

        item.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            startX = event.clientX;
            startY = event.clientY;
            offsetX = 0;
            shell.dataset.suppressClick = 'false';
            holdTimer = setTimeout(() => {
                isHolding = true;
                shell.classList.add('swipe-ready');
                navigator.vibrate?.(12);
            }, 360);
        });

        item.addEventListener('pointermove', event => {
            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;

            if (!isHolding) {
                if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) clearTimeout(holdTimer);
                return;
            }
            if (Math.abs(deltaY) > Math.abs(deltaX) + 14 && !isSwiping) return;

            isSwiping = true;
            offsetX = deltaX;
            shell.dataset.suppressClick = 'true';
            shell.classList.add('swiping');
            item.setPointerCapture?.(event.pointerId);
            item.style.transform = `translateX(${offsetX}px) scale(${Math.max(.97, 1 - Math.abs(offsetX) / 5000)})`;
        });

        const finishSwipe = () => {
            clearTimeout(holdTimer);
            if (!isSwiping) {
                if (isHolding) shell.dataset.suppressClick = 'true';
                reset();
                return;
            }

            const threshold = Math.min(110, shell.offsetWidth * .34);
            if (Math.abs(offsetX) >= threshold) {
                shell.dataset.swipeDirection = String(offsetX < 0 ? -1 : 1);
                isSwiping = false;
                dismissNotification(shell);
                return;
            }
            reset();
        };

        item.addEventListener('pointerup', finishSwipe);
        item.addEventListener('pointercancel', reset);
        item.addEventListener('lostpointercapture', () => {
            if (isSwiping) finishSwipe();
        });
    });
}

function toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) {
        closeNotificationPanel();
        return;
    }

    renderNotificationPanel();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.getElementById('notificationPanelOverlay')?.classList.add('show');
    document.getElementById('notificationBtn')?.setAttribute('aria-expanded', 'true');
}

function closeNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById('notificationPanelOverlay')?.classList.remove('show');
    document.getElementById('notificationBtn')?.setAttribute('aria-expanded', 'false');
}

function openNotificationReceivables() {
    closeNotificationPanel();
    setUtilityReturnPage('main');
    hideAllPages();
    document.getElementById('receivablesManagementPage').classList.remove('hidden');
    selectReceivableTab('due');
}

function getDdayText(paymentDueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueDate = new Date(`${paymentDueDate}T00:00:00`);
    dueDate.setHours(0, 0, 0, 0);

    const difference = Math.round((dueDate - today) / 86400000);

    if (difference === 0) return 'D-Day';
    if (difference > 0) return `D-${difference}`;
    return `D+${Math.abs(difference)} 연체`;
}

function renderReceivablesManagement(tab) {
    currentReceivableTab = tab;
    const container = document.getElementById('receivablesListContainer');
    const items = getReceivableItems();
    // 서브 차량이 하나도 없는(메인만 쓰는) 계정에는 차량 구분 배지를 아예 노출하지 않는다.
    const hasSubCars = (getUserSettings().cars || []).some(car => car.type === 'sub');

    if (tab === 'monthly') {
        const grouped = {};

        items.forEach(item => {
            const monthKey = item.workDate.slice(0, 7);
            const groupKey = `${item.client}|${monthKey}`;

            if (!grouped[groupKey]) {
                grouped[groupKey] = {
                    client: item.client,
                    monthKey,
                    total: 0,
                    count: 0,
                    items: []
                };
            }

            grouped[groupKey].total += item.remainingAmount;
            grouped[groupKey].count += 1;
            grouped[groupKey].items.push(item);
        });

        const groups = Object.values(grouped).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

        if (groups.length === 0) {
            container.innerHTML = '<div class="receivable-empty">미수금 내역이 없습니다.</div>';
            return;
        }

        container.innerHTML = groups.map(group => {
            const [year, month] = group.monthKey.split('-');
            // 한 그룹(같은 거래처+월)에 여러 차량의 기록이 섞여 있을 수 있으므로, 관련된
            // 차량을 전부 모아 배지로 보여준다(중복 제거).
            const distinctLogs = hasSubCars
                ? [...new Map(group.items.map(i => [i.logId, i])).values()]
                : [];
            const carBadges = distinctLogs
                .map(i => `<span class="management-badge car-type${i.logId === 'main' ? ' main' : ''}">${escapeDetailText(i.logLabel)}</span>`)
                .join('');
            return `
                <div class="receivable-group-card">
                    <div class="receivable-group-head">
                        <div class="receivable-group-title">${escapeDetailText(group.client)}</div>
                        <div class="receivable-group-period">${year}년 ${parseInt(month, 10)}월 운행분</div>
                    </div>
                    ${carBadges ? `<div class="receivable-group-cars">${carBadges}</div>` : ''}
                    <div class="receivable-group-summary">
                        <span class="receivable-summary-label">미수금</span>
                        <strong class="receivable-summary-amount">${group.total.toLocaleString()}원</strong>
                        <span class="receivable-summary-separator" aria-hidden="true">·</span>
                        <span class="receivable-summary-count">${group.count}건</span>
                    </div>
                    <div class="receivable-card-actions">
                        <button type="button" class="receivable-detail-btn" onclick="openReceivableDetail('${encodeURIComponent(group.client)}', '${group.monthKey}')">미수금 상세</button>
                        <button type="button" class="receivable-complete-btn" onclick="markMonthlyReceivablesPaid('${escapeForInlineHandlerArg(group.client)}', '${group.monthKey}')">입금 완료 처리</button>
                    </div>
                </div>
            `;
        }).join('');

        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueItems = items
        .filter(item => {
            if (!item.paymentDueDate) return false;
            const dueDate = new Date(`${item.paymentDueDate}T00:00:00`);
            dueDate.setHours(0, 0, 0, 0);
            const difference = Math.round((dueDate - today) / 86400000);
            return difference <= 3;
        })
        .sort((a, b) => a.paymentDueDate.localeCompare(b.paymentDueDate));

    if (dueItems.length === 0) {
        container.innerHTML = '<div class="receivable-empty">D-3 이내 또는 연체된 미수금이 없습니다.</div>';
        return;
    }

    container.innerHTML = dueItems.map(item => {
        const workMonth = item.workDate.slice(0, 7).replace('-', '년 ') + '월';
        const carBadge = hasSubCars
            ? `<div class="receivable-item-car"><span class="management-badge car-type${item.logId === 'main' ? ' main' : ''}">${escapeDetailText(item.logLabel)}</span></div>`
            : '';
        return `
            <div class="receivable-item-card">
                <div class="receivable-item-row">
                    <div>
                        <div class="receivable-item-client">${escapeDetailText(item.client)}</div>
                        ${carBadge}
                        <div class="receivable-item-info">${workMonth} 운행분</div>
                        <div class="receivable-item-info">입금 예정일: ${item.paymentDueDate.replace(/-/g, '.')}</div>
                        <div class="receivable-dday">${getDdayText(item.paymentDueDate)}</div>
                    </div>
                    <div class="receivable-item-amount">${item.remainingAmount.toLocaleString()}원</div>
                </div>
            </div>
        `;
    }).join('');
}

function openReceivableDetail(encodedClientName, monthKey) {
    const clientName = decodeURIComponent(encodedClientName);
    currentReceivableDetail = { clientName, monthKey };
    hideAllPages();
    document.getElementById('receivableDetailPage').classList.remove('hidden');
    renderReceivableDetail();
}

function closeReceivableDetail() {
    hideAllPages();
    document.getElementById('receivablesManagementPage').classList.remove('hidden');
    selectReceivableTab(currentReceivableTab);
}

function getCurrentReceivableDetailItems() {
    if (!currentReceivableDetail) return [];
    return getReceivableItems()
        .filter(item => item.client === currentReceivableDetail.clientName && item.workDate.slice(0, 7) === currentReceivableDetail.monthKey)
        .sort((a, b) => a.workDate.localeCompare(b.workDate));
}

function renderReceivableDetail() {
    if (!currentReceivableDetail) return closeReceivableDetail();

    const items = getCurrentReceivableDetailItems();
    const { clientName, monthKey } = currentReceivableDetail;
    const [year, month] = monthKey.split('-');
    const total = items.reduce((sum, item) => sum + item.remainingAmount, 0);
    const dueDates = items.map(item => item.paymentDueDate).filter(Boolean).sort();
    // 서브 차량이 하나도 없는(메인만 쓰는) 계정에는 차량 구분 배지를 아예 노출하지 않는다.
    const hasSubCars = (getUserSettings().cars || []).some(car => car.type === 'sub');

    document.getElementById('receivableDetailClient').textContent = clientName;
    document.getElementById('receivableDetailPeriod').textContent = `${year}년 ${parseInt(month, 10)}월 운행분`;
    document.getElementById('receivableDetailTotal').textContent = `${total.toLocaleString()}원`;
    document.getElementById('receivableDetailCount').textContent = `${items.length}건`;
    document.getElementById('receivableDetailMeta').textContent = dueDates.length
        ? `입금 예정일 ${dueDates[0].replace(/-/g, '.')}`
        : '입금 예정일 미등록';

    const list = document.getElementById('receivableDetailList');
    const allPaidButton = document.getElementById('receivableDetailAllPaidBtn');
    allPaidButton.disabled = items.length === 0;

    if (items.length === 0) {
        list.innerHTML = '<div class="receivable-empty">모든 미수금이 입금 완료 처리되었습니다.</div>';
        return;
    }

    list.innerHTML = items.map(item => {
        const route = item.loadLoc || item.unloadLoc
            ? `${escapeDetailText(item.loadLoc || '상차지 미상')} <span aria-hidden="true">→</span> ${escapeDetailText(item.unloadLoc || '하차지 미상')}`
            : '운행 구간 미등록';
        const due = item.paymentDueDate
            ? `<span>입금 예정 ${item.paymentDueDate.replace(/-/g, '.')}</span><b>${getDdayText(item.paymentDueDate)}</b>`
            : '<span>입금 예정일 미등록</span>';

        const isPartial = item.paymentSummaryStatus === 'partial';
        const statusText = isPartial
            ? `${item.paidAmount.toLocaleString()}원 입금 · ${item.remainingAmount.toLocaleString()}원 남음`
            : '미수';
        const payments = Array.isArray(item.payments) ? item.payments : [];
        const historyRows = payments.map(payment => {
            const paidAtText = payment.paidAt
                ? new Date(payment.paidAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '-';
            return `<div class="receivable-payment-history-row"><span>${escapeDetailText(paidAtText)}</span><span>${parseCurrencyValue(payment.amount).toLocaleString()}원</span></div>`;
        }).join('');

        const carBadge = hasSubCars
            ? `<span class="management-badge car-type${item.logId === 'main' ? ' main' : ''}">${escapeDetailText(item.logLabel)}</span>`
            : '';

        return `
            <article class="receivable-detail-item">
                <div class="receivable-detail-item-top">
                    <time datetime="${item.workDate}">${item.workDate.replace(/-/g, '.')}</time>
                    <strong>${item.remainingAmount.toLocaleString()}원</strong>
                </div>
                ${carBadge ? `<div class="receivable-detail-car">${carBadge}</div>` : ''}
                <div class="receivable-detail-route">${route}</div>
                <div class="receivable-detail-due">${due}</div>
                ${item.remarks ? `<p class="receivable-detail-remarks">${escapeDetailText(item.remarks)}</p>` : ''}
                <div class="receivable-payment-status ${isPartial ? 'partial' : 'unpaid'}">${statusText} <span class="receivable-original-fare">(전체 ${item.fare.toLocaleString()}원)</span></div>
                ${payments.length ? `<button type="button" class="receivable-history-toggle-btn" onclick="togglePaymentHistory(this)">입금 내역 보기 (${payments.length}건)</button>
                <div class="receivable-payment-history hidden">${historyRows}</div>` : ''}
                <div class="receivable-item-actions">
                    <button type="button" class="receivable-item-paid-btn" onclick="markReceivableItemPaid('${escapeForInlineHandlerArg(item.logId)}', '${item.dateKey}', ${item.detailIndex})">이 건 입금 완료</button>
                    <button type="button" class="receivable-item-partial-btn" onclick="togglePartialPaymentInput(this)">부분 입금 처리</button>
                    ${payments.length ? `<button type="button" class="receivable-item-undo-btn" onclick="undoLastPayment('${escapeForInlineHandlerArg(item.logId)}', '${item.dateKey}', ${item.detailIndex})">취소</button>` : ''}
                </div>
                <div class="receivable-partial-input-row hidden">
                    <input type="text" inputmode="numeric" class="input-box receivable-partial-amount" placeholder="입금액 입력" oninput="formatCurrencyInput(this)">
                    <button type="button" class="receivable-partial-confirm-btn" onclick="confirmPartialPayment(this, '${escapeForInlineHandlerArg(item.logId)}', '${item.dateKey}', ${item.detailIndex})">확인</button>
                </div>
            </article>`;
    }).join('');
}

function togglePartialPaymentInput(btnEl) {
    const row = btnEl.closest('.receivable-detail-item')?.querySelector('.receivable-partial-input-row');
    if (!row) return;
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) {
        row.querySelector('input')?.focus();
    }
}

function togglePaymentHistory(btnEl) {
    btnEl.closest('.receivable-detail-item')?.querySelector('.receivable-payment-history')?.classList.toggle('hidden');
}

// 부분 입금 등록: payments 배열에 한 건을 추가한다. 남은 금액을 초과하는 입력은 막는다.
// logId('main' 또는 서브 차량 번호)로 그 항목이 속한 실제 로그를 찾아 반영한다 — 지금 열려
// 있는 차량 로그가 아니어도 정확히 그 차량의 저장소에 반영된다.
function addPartialPayment(logId, dateKey, detailIndex, amount) {
    const store = readWorkDataStoreForLog(logId);
    const detail = store[dateKey]?.callDetails?.[detailIndex];
    if (!detail) return;

    const value = parseCurrencyValue(amount);
    if (!(value > 0)) {
        showToastMessage('입금액을 올바르게 입력해 주세요.');
        return;
    }

    const summary = getDetailPaymentSummary(detail);
    if (value > summary.remainingAmount) {
        showToastMessage('남은 금액보다 큰 금액은 입력할 수 없습니다.');
        return;
    }

    if (!Array.isArray(detail.payments)) {
        // 레거시 데이터 이전: payments 없이 이미 완료 처리된 기록이 있었다면 결제 이력 1건으로 보존
        detail.payments = [];
        if ((detail.paymentStatus || '미수') !== '미수') {
            const fare = parseCurrencyValue(detail.fare);
            if (fare > 0) {
                detail.payments.push({ id: generateLocalId('pay'), amount: fare, paidAt: new Date().toISOString(), note: '(이전 기록)' });
            }
        }
    }

    detail.payments.push({ id: generateLocalId('pay'), amount: value, paidAt: new Date().toISOString(), note: '' });
    syncDetailPaymentStatus(detail);

    writeWorkDataStoreForLog(logId, store);
    if (logId === activeLogId) buildCalendar();
    renderReceivableDetail();
    showToastMessage('부분 입금을 등록했습니다.');
}

function confirmPartialPayment(btnEl, logId, dateKey, detailIndex) {
    const input = btnEl.closest('.receivable-partial-input-row')?.querySelector('input');
    if (!input) return;
    addPartialPayment(logId, dateKey, detailIndex, input.value);
}

// 가장 최근에 추가된 입금 기록 1건만 되돌린다 (전체 초기화가 아님).
function undoLastPayment(logId, dateKey, detailIndex) {
    const store = readWorkDataStoreForLog(logId);
    const detail = store[dateKey]?.callDetails?.[detailIndex];
    if (!detail || !Array.isArray(detail.payments) || detail.payments.length === 0) {
        showToastMessage('되돌릴 입금 기록이 없습니다.');
        return;
    }

    showConfirmModal('가장 최근 입금 기록 1건을 취소하시겠습니까?', () => {
        detail.payments.pop();
        syncDetailPaymentStatus(detail);
        writeWorkDataStoreForLog(logId, store);
        if (logId === activeLogId) buildCalendar();
        renderReceivableDetail();
        showToastMessage('입금 기록을 취소했습니다.');
    });
}

// "이 건 입금 완료": 남은 금액 전액을 결제 이력 한 건으로 등록해 완납 처리한다.
// (부분입금이 이미 있는 상태에서 눌러도 잔액만큼만 추가되므로 중복 합산되지 않는다.)
function markReceivableItemPaid(logId, dateKey, detailIndex) {
    const store = readWorkDataStoreForLog(logId);
    const detail = store[dateKey]?.callDetails?.[detailIndex];
    const summary = detail ? getDetailPaymentSummary(detail) : null;
    if (!detail || summary.status === 'paid') {
        showToastMessage('이미 처리된 내역입니다.');
        return renderReceivableDetail();
    }

    if (!Array.isArray(detail.payments)) detail.payments = [];
    if (summary.remainingAmount > 0) {
        detail.payments.push({ id: generateLocalId('pay'), amount: summary.remainingAmount, paidAt: new Date().toISOString(), note: '' });
    }
    syncDetailPaymentStatus(detail);

    writeWorkDataStoreForLog(logId, store);
    if (logId === activeLogId) buildCalendar();
    renderReceivableDetail();
    showToastMessage('입금 완료 처리했습니다.');
}

function markCurrentReceivableGroupPaid() {
    if (!currentReceivableDetail) return;
    markMonthlyReceivablesPaid(currentReceivableDetail.clientName, currentReceivableDetail.monthKey, true);
}

// 그룹(거래처+월)에 속한 항목이 여러 차량 로그에 걸쳐 있을 수 있으므로, getReceivableItems()로
// 정확히 같은 대상을 다시 추려서 로그별로 묶은 뒤 각 로그의 저장소에 정확히 반영한다.
function markMonthlyReceivablesPaid(clientName, monthKey, stayOnDetail = false) {
    const targets = getReceivableItems().filter(item =>
        item.client === clientName && item.workDate.slice(0, 7) === monthKey
    );

    const itemsByLog = new Map();
    targets.forEach(item => {
        if (!itemsByLog.has(item.logId)) itemsByLog.set(item.logId, []);
        itemsByLog.get(item.logId).push(item);
    });

    itemsByLog.forEach((logItems, logId) => {
        const store = readWorkDataStoreForLog(logId);
        logItems.forEach(({ dateKey, detailIndex }) => {
            const detail = store[dateKey]?.callDetails?.[detailIndex];
            if (!detail) return;

            const summary = getDetailPaymentSummary(detail);
            if (summary.status === 'paid') return;

            if (!Array.isArray(detail.payments)) detail.payments = [];
            if (summary.remainingAmount > 0) {
                detail.payments.push({ id: generateLocalId('pay'), amount: summary.remainingAmount, paidAt: new Date().toISOString(), note: '' });
            }
            syncDetailPaymentStatus(detail);
        });
        writeWorkDataStoreForLog(logId, store);
    });

    if (itemsByLog.has(activeLogId)) buildCalendar();
    if (stayOnDetail) renderReceivableDetail();
    else renderReceivablesManagement('monthly');
    showToastMessage(`${clientName} ${parseInt(monthKey.slice(5, 7), 10)}월분 미수금을 수금 완료 처리했습니다.`);
}

// ========== 세금계산서 관리 ==========
let taxInvoiceViewMonth = '';
let currentTaxInvoiceTab = 'draft';
let currentTaxInvoiceFlow = 'sales';

function getTaxInvoiceRecords() {
    try {
        const records = JSON.parse(localStorage.getItem('taxInvoiceRecords') || '[]');
        return Array.isArray(records) ? records : [];
    } catch (error) {
        return [];
    }
}

function saveTaxInvoiceRecords(records) {
    localStorage.setItem('taxInvoiceRecords', JSON.stringify(records));
    scheduleNormalizedEntitySync();
}

function getTaxInvoiceFlowMeta(flow = currentTaxInvoiceFlow) {
    const flows = {
        sales: { label: '매출 발행', partyHeading: '공급받는 자', itemName: '화물운송료', completeLabel: '발급 완료' },
        purchase: { label: '기사 매입', partyHeading: '공급자', itemName: '화물운송 용역', completeLabel: '수취 완료' },
        commission: { label: '수수료 발행', partyHeading: '공급받는 자', itemName: '운송 중개 수수료', completeLabel: '발급 완료' }
    };
    return flows[flow] || flows.sales;
}

function getTaxInvoiceRecordId(monthKey, partyKey, flow = currentTaxInvoiceFlow) {
    return `${flow}|${monthKey}|${partyKey}`;
}

function readWorkDataStorage(key) {
    try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        return data && typeof data === 'object' ? data : {};
    } catch (error) {
        return {};
    }
}

// 이 차량이 초대 코드로 연동된 기사차량이든 아니든, 실제 운행 기록은 항상 같은 로컬 키
// (workData_<차량번호>)에서 읽는다. 연동된 기사차량의 경우 그 키는 initWorkDataFromSupabase()가
// 로그인/새로고침 때마다 Supabase(daily_logs/transport_details, vehicle_id 기준)에서 실제
// 기사가 작성한 기록을 그대로 받아와 채워둔다 — settings.cars의 모든 차량(메인+기사차량)을
// car.supabaseId 기준으로 동일하게 처리하기 때문에 여기서 따로 분기할 필요가 없다.
// (예전엔 여기서 getLinkedDriverRecordData()라는, 이미 삭제된 로컬 전용 함수를 불렀는데 —
// 그 함수가 없어지면서 연동된 기사차량이 있는 계정의 미수금/월매출/세금계산서 집계가 전부
// ReferenceError로 깨지고 있었다. 실제로 재현해서 확인하고 고쳤다.)
function getDriverCarWorkData(car, settings) {
    return readWorkDataStorage(`workData_${car.number}`);
}

// link(연동 기사 할당 정보)가 주어지면 assignmentStart/End 밖의 날짜는 집계에서 제외한다.
// 소속기사 개인 조회가 아니라 "차주가 연동 기사의 기록을 집계"할 때만 쓰이는 함수다.
function getMonthlyDriverTotals(data, monthKey, link = null) {
    let grossAmount = 0;
    let insuranceAmount = 0;
    let count = 0;
    Object.entries(data || {}).forEach(([dateKey, record]) => {
        if (!dateKey.startsWith(monthKey) || !record || typeof record !== 'object') return;
        if (!isDateWithinAssignment(dateKey, link?.assignmentStart, link?.assignmentEnd)) return;
        const details = Array.isArray(record.callDetails) ? record.callDetails : [];
        details.forEach(detail => {
            const workDate = detail.workDate || dateKey;
            if (!workDate.startsWith(monthKey)) return;
            if (!isDateWithinAssignment(workDate, link?.assignmentStart, link?.assignmentEnd)) return;
            grossAmount += parseCurrencyValue(detail.fare);
            insuranceAmount += parseCurrencyValue(detail.insuranceFee);
            count += 1;
        });
        const fixedFare = parseCurrencyValue(record.fare || record.fixedFare || record.totalFare);
        if (fixedFare > 0) grossAmount += fixedFare;
        count += Number(record.fixedCount || record.count || 0);
    });
    return { grossAmount, insuranceAmount, count };
}


function calculateDriverVehicleCommission(car, grossAmount, count) {
    if (!car?.commEnabled || !car.commission) return 0;
    const tripCount = Number(count) || 0;
    // 건당(direct) 수수료는 실제 운행 건수만큼만 청구한다. Math.max(1, count)로 최소 1건을
    // 강제하면, 이번 달 운행이 0회인 기사차량도 건당 수수료 1건분이 그대로 청구돼 정산이
    // 마이너스로 나오는 결함이 있었다(실제로 확인됨).
    if (car.commType === 'direct') return tripCount > 0 ? parseCurrencyValue(car.commission) * tripCount : 0;
    return Math.floor(grossAmount * (parseFloat(car.commission) || 0) / 100);
}

// 월매출("월매출" 화면) 전용 순수 계산 함수. buildCalendar()의 고정노선/파렛트/콜상세
// 운송료 공식을 그대로 따르되, 여기서는 화면(DOM)을 전혀 건드리지 않고 값만 계산해서
// 반환한다 — buildCalendar() 자체는 그대로 두고 별도로 새로 만든 함수다.
// 세금계산서 집계(getTaxInvoiceSourceGroups)와 동일한 기준으로 메인 차량 + "회사 정산"/
// "고용 정산" 모드인 서브 차량만 합산한다(기사 직접 정산 차량은 그 매출이 회사 몫이
// 아니므로 제외).
// 차량의 "기사 월매출 조회" 스위치(shareRevenueWithOwner)가 꺼져 있으면 이 화면(월매출
// 집계)에서만 제외한다 — 실제 운행기록/서버 데이터는 전혀 건드리지 않고, 다른 화면(미수금,
// 세금계산서 등)에도 영향을 주지 않는 "이 화면 한정" 조회 권한이다.
function getMonthlyFareRevenue(monthKey) {
    const settings = getUserSettings();
    const cars = Array.isArray(settings.cars) ? settings.cars : [];

    const sources = [{ logId: 'main', label: '메인 차량', data: readWorkDataStorage('workData') }];
    cars.filter(car => car.type === 'sub' && isVehicleRevenueSharedWithOwner(car)).forEach(car => {
        const mode = getEffectiveDriverSettlementMode(car, settings);
        if (mode === 'company' || mode === 'employee') {
            sources.push({ logId: car.number, label: getShortCarNum(car.number), data: getDriverCarWorkData(car, settings) });
        }
    });

    let totalFare = 0;
    let tripCount = 0;
    const byVehicle = [];

    const fixedRouteClientForTotals = getFixedRouteClient(settings);
    sources.forEach(source => {
        const isMain = source.logId === 'main';
        const activeFixedOn = isMain ? settings.fixedOn : settings.subFixedOn;
        const activePalletOn = !!fixedRouteClientForTotals?.palletOn;
        const fixedUnitPrice = parseCurrencyValue(fixedRouteClientForTotals?.fixedUnitPrice);
        const palletUnitPrice = parseCurrencyValue(fixedRouteClientForTotals?.palletPrice);

        let vehicleFare = 0;
        let vehicleCount = 0;

        Object.entries(source.data || {}).forEach(([dateKey, record]) => {
            if (!dateKey.startsWith(monthKey) || !record || typeof record !== 'object' || record.isOff) return;

            if (record.fixedCount > 0) {
                vehicleCount += parseInt(record.fixedCount, 10) || 0;
                vehicleFare += (Number(record.fixedCount) || 0) * fixedUnitPrice;
            }
            if (record.palletCount > 0 && activeFixedOn && activePalletOn) {
                vehicleFare += (Number(record.palletCount) || 0) * palletUnitPrice;
            }

            (Array.isArray(record.callDetails) ? record.callDetails : []).forEach(detail => {
                // 운행 건수 집계 규칙은 buildCalendar()와 동일하게 맞춘다(공차는 제외, 혼짐은
                // 대표 건만 카운트).
                const type = detail?.distanceType || '';
                if (type === '공차') {
                    // 0회 처리
                } else if (type === '혼짐') {
                    if (detail.linkedLoadIndex === 'pending' || detail.linkedLoadIndex === '-1' || detail.linkedLoadIndex === undefined) {
                        vehicleCount += 1;
                    }
                } else {
                    vehicleCount += 1;
                }

                const gross = parseCurrencyValue(detail?.fare);
                vehicleFare += gross;
            });
        });

        totalFare += vehicleFare;
        tripCount += vehicleCount;
        byVehicle.push({ logId: source.logId, label: source.label, fare: vehicleFare, tripCount: vehicleCount });
    });

    return { totalFare, tripCount, byVehicle };
}

function getTaxInvoiceSourceGroups(monthKey, flow = currentTaxInvoiceFlow) {
    const settings = getUserSettings();
    const cars = settings.cars || [];
    if (flow === 'sales') {
        // 그룹 키는 "월 + 차량(운행 로그) + 거래처" 기준이다 — 같은 거래처라도 차량이 다르면
        // (설령 두 차량이 같은 사업자로 정산되는 소속기사 차량이라도) 절대 하나로 합치지 않고
        // 차량별로 세금계산서를 분리한다. 예전에는 "공급사업자(supplier.key)"만 같으면 메인
        // 차량과 소속기사 차량 매출이 한 장으로 합산돼서, 캘린더(차량 1대분)와 세금계산서
        // (여러 차량 합산분) 금액이 안 맞아 보이는 문제가 있었다(실제로 보고됨: 사용자가 차량별
        // 분리 발행을 원함).
        const grouped = {};
        // 예전엔 "세금계산서 사용" 토글이 켜진 거래처만 이 목록에 걸러서 보여줬는데, 그 토글
        // 자체를 없앴다(§거래처 등록 개편) — 이제 실제로 매출이 잡힌 거래처는 전부 목록에
        // 뜨고, 사업자번호 등 필수 정보가 비어 있으면 발급 시점에 그때 안내한다(changeTaxInvoiceStatus).
        const sources = [{ logId: 'main', car: null, data: readWorkDataStorage('workData') }];
        cars.filter(car => car.type === 'sub').forEach(car => {
            const mode = getEffectiveDriverSettlementMode(car, settings);
            if (mode === 'company' || mode === 'employee') sources.push({ logId: car.number, car, data: getDriverCarWorkData(car, settings) });
        });
        const getOrCreateGroup = (clientName, supplier, vehicleKey) => {
            const groupKey = `${clientName}__${vehicleKey}`;
            if (!grouped[groupKey]) {
                grouped[groupKey] = {
                    partyKey: groupKey, clientName, partyType: 'client',
                    count: 0, supplyAmount: 0, taxAmount: 0,
                    supplierKey: supplier.key, supplierBiz: supplier.biz, vehicleLabel: supplier.carLabel,
                    vehicleNumbers: new Set()
                };
            }
            return grouped[groupKey];
        };

        const fixedRouteClientForInvoice = getFixedRouteClient(settings);
        const fixedClientName = fixedRouteClientForInvoice?.companyName || '';
        const fixedUnitPrice = parseCurrencyValue(fixedRouteClientForInvoice?.fixedUnitPrice);

        sources.forEach(source => {
            const supplier = getVehicleSupplierIdentity(source.car, settings);
            // 고정노선 거래처 연동 — 이제 거래처 등록 화면에서 지정한 거래처 1곳(계정 전체
            // 공용) 기준이다. 콜상세 없이 fixedCount(고정노선 운행 건수)만으로 매출이 잡히는
            // 것도 예전과 동일하게 여기서 함께 집계한다.
            Object.entries(source.data || {}).forEach(([dateKey, record]) => {
                (record?.callDetails || []).forEach(detail => {
                    const workDate = detail.workDate || dateKey;
                    const clientName = (detail.client || '').trim();
                    const supplyAmount = parseCurrencyValue(detail.fare);
                    if (!workDate.startsWith(monthKey) || !clientName || supplyAmount <= 0) return;
                    const group = getOrCreateGroup(clientName, supplier, source.logId);
                    group.count += 1;
                    group.supplyAmount += supplyAmount;
                    group.taxAmount += detail.vatExempt ? 0 : Math.round(supplyAmount * .1);
                    if (supplier.carNumber) group.vehicleNumbers.add(supplier.carNumber);
                });

                const fixedCount = parseInt(record?.fixedCount, 10) || 0;
                if (fixedCount > 0 && fixedClientName && dateKey.startsWith(monthKey)) {
                    const supplyAmount = fixedCount * fixedUnitPrice;
                    if (supplyAmount > 0) {
                        const group = getOrCreateGroup(fixedClientName, supplier, source.logId);
                        group.count += fixedCount;
                        group.supplyAmount += supplyAmount;
                        group.taxAmount += Math.round(supplyAmount * .1);
                        if (supplier.carNumber) group.vehicleNumbers.add(supplier.carNumber);
                    }
                }
            });
        });
        return Object.values(grouped).map(group => ({
            ...group,
            vehicleNumbers: Array.from(group.vehicleNumbers),
            totalAmount: group.supplyAmount + group.taxAmount
        }));
    }

    return cars.filter(car => car.type === 'sub').flatMap(car => {
        const mode = getEffectiveDriverSettlementMode(car, settings);
        if ((flow === 'purchase' && mode !== 'company') || (flow === 'commission' && mode !== 'driver_direct')) return [];
        const link = (settings.driverLinks || []).find(item => item.id === car.driverLinkId || item.vehicleNumber === car.number);
        const totals = getMonthlyDriverTotals(getDriverCarWorkData(car, settings), monthKey, link);
        if (totals.grossAmount <= 0) return [];
        const commissionAmount = calculateDriverVehicleCommission(car, totals.grossAmount, totals.count);
        const insuranceAmount = car.insuranceOn ? totals.insuranceAmount : 0;
        const netAmount = Math.max(0, totals.grossAmount - commissionAmount - insuranceAmount);
        const supplyAmount = flow === 'purchase'
            ? (settings.driverInvoiceBasis === 'gross' ? totals.grossAmount : netAmount)
            : commissionAmount;
        if (supplyAmount <= 0) return [];
        const taxAmount = Math.round(supplyAmount * .1);
        return [{
            partyKey: car.number,
            clientName: car.driverName || car.personalInfo?.driverName || getShortCarNum(car.number),
            partyType: 'driver',
            carNumber: car.number,
            count: totals.count,
            grossAmount: totals.grossAmount,
            commissionAmount,
            insuranceAmount,
            netAmount,
            supplyAmount,
            taxAmount,
            totalAmount: supplyAmount + taxAmount
        }];
    });
}

function getTaxInvoicePartyInfo(group) {
    const settings = getUserSettings();
    if (group.partyType === 'client') {
        const client = (settings.clients || []).find(item => item.companyName === group.clientName) || {};
        return { clientBizNumber:client.bizNumber || '', clientRepresentative:client.taxRepresentative || client.managerName || '', clientAddress:client.taxAddress || '', clientBizType:client.taxBizType || '', clientBizItem:client.taxBizItem || '', clientEmail:client.taxEmail || '' };
    }
    const car = (settings.cars || []).find(item => item.number === group.carNumber) || {};
    const info = car.personalInfo || {};
    return { clientBizNumber:info.bizNumber || '', clientRepresentative:info.name || car.driverName || '', clientAddress:info.address || '', clientBizType:info.bizType || '', clientBizItem:info.bizItem || '', clientEmail:info.email || '', carNumber:car.number };
}

function buildTaxInvoiceEntry(group, flow = currentTaxInvoiceFlow) {
    const id = getTaxInvoiceRecordId(taxInvoiceViewMonth, group.partyKey, flow);
    const saved = getTaxInvoiceRecords().find(item => item.id === id) || {};
    const meta = getTaxInvoiceFlowMeta(flow);
    return { ...getTaxInvoicePartyInfo(group), itemName:meta.itemName, remark:`${parseInt(taxInvoiceViewMonth.slice(5, 7), 10)}월 ${meta.itemName}`, ...saved, ...group, id, flow, logId:group.carNumber || 'fleet', monthKey:taxInvoiceViewMonth, status:saved.status || 'draft' };
}

function showTaxInvoices(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    document.getElementById('sideMenu')?.classList.remove('open');
    document.getElementById('sideMenuOverlay')?.classList.remove('show');
    hideAllPages();
    document.getElementById('taxInvoicePage').classList.remove('hidden');
    if (!taxInvoiceViewMonth) {
        const now = new Date();
        taxInvoiceViewMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    document.getElementById('taxInvoiceMonth').value = taxInvoiceViewMonth;
    renderTaxInvoices();
}

function changeTaxInvoiceMonth(value) {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    taxInvoiceViewMonth = value;
    const monthInput = document.getElementById('taxInvoiceMonth');
    if (monthInput && monthInput.value !== value) monthInput.value = value;
    renderTaxInvoices();
}

function changeTaxInvoiceMonthBy(offset) {
    if (!taxInvoiceViewMonth) return;
    const [year, month] = taxInvoiceViewMonth.split('-').map(Number);
    const targetDate = new Date(year, month - 1 + Number(offset || 0), 1);
    changeTaxInvoiceMonth(`${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`);
}

function selectTaxInvoiceTab(tab) {
    currentTaxInvoiceTab = tab === 'issued' ? 'issued' : 'draft';
    renderTaxInvoices();
}

function selectTaxInvoiceFlow(flow) {
    currentTaxInvoiceFlow = ['sales', 'purchase', 'commission'].includes(flow) ? flow : 'sales';
    currentTaxInvoiceTab = 'draft';
    renderTaxInvoices();
}

function renderTaxInvoices() {
    const settings = getUserSettings();
    const issuerReady = settings.bizName && settings.bizNumber && settings.userName && settings.bizType && settings.bizItem;
    const guide = document.getElementById('taxInvoiceIssuerGuide');
    const flowMeta = getTaxInvoiceFlowMeta();
    guide.className = `tax-invoice-guide${issuerReady ? ' ready' : ''}`;
    if (currentTaxInvoiceFlow === 'purchase') {
        guide.innerHTML = issuerReady
            ? `<strong>기사에게 받을 매입 계산서</strong><span>${settings.driverInvoiceBasis === 'gross' ? '총 운송료' : '수수료·산재보험 차감 후 기사 정산액'} 기준 · 공급받는 자 ${escapeDetailText(settings.bizName)}</span>`
            : '<strong>회사 사업자 정보가 필요합니다.</strong><span>마이페이지 → 개인정보에서 계산서를 받을 회사의 사업자 정보를 입력해 주세요.</span>';
    } else {
        guide.innerHTML = issuerReady
            ? `<strong>${escapeDetailText(settings.bizName)}</strong><span>${escapeDetailText(settings.bizNumber)} · ${flowMeta.label} · ${escapeDetailText(settings.bizType)} / ${escapeDetailText(settings.bizItem)}</span>`
            : '<strong>회사 사업자 정보가 필요합니다.</strong><span>마이페이지 → 개인정보에서 계산서를 발행할 회사의 사업자 정보를 입력해 주세요.</span>';
    }

    const flowGroups = {
        sales: getTaxInvoiceSourceGroups(taxInvoiceViewMonth, 'sales'),
        purchase: getTaxInvoiceSourceGroups(taxInvoiceViewMonth, 'purchase'),
        commission: getTaxInvoiceSourceGroups(taxInvoiceViewMonth, 'commission')
    };
    ['sales', 'purchase', 'commission'].forEach(flow => {
        const cap = flow.charAt(0).toUpperCase() + flow.slice(1);
        document.getElementById(`taxInvoice${cap}FlowCount`).textContent = flowGroups[flow].length;
        document.getElementById(`taxInvoice${cap}FlowTab`).classList.toggle('active', currentTaxInvoiceFlow === flow);
    });

    const sourceEntries = flowGroups[currentTaxInvoiceFlow].map(group => buildTaxInvoiceEntry(group, currentTaxInvoiceFlow));
    const storedIssued = getTaxInvoiceRecords().filter(item => item.flow === currentTaxInvoiceFlow && item.monthKey === taxInvoiceViewMonth && item.status === 'issued');
    const issuedById = new Map(storedIssued.map(item => [item.id, item]));
    sourceEntries.forEach(item => { if (item.status === 'issued') issuedById.set(item.id, item); });
    const issuedEntries = [...issuedById.values()];
    const draftEntries = sourceEntries.filter(item => item.status !== 'issued');

    document.getElementById('taxInvoiceDraftCount').textContent = draftEntries.length;
    document.getElementById('taxInvoiceIssuedCount').textContent = issuedEntries.length;
    document.getElementById('taxInvoiceDraftTab').classList.toggle('active', currentTaxInvoiceTab === 'draft');
    document.getElementById('taxInvoiceIssuedTab').classList.toggle('active', currentTaxInvoiceTab === 'issued');
    document.getElementById('taxInvoiceDraftTab').childNodes[0].nodeValue = currentTaxInvoiceFlow === 'purchase' ? '수취 전 ' : '작성 전 ';
    document.getElementById('taxInvoiceIssuedTab').childNodes[0].nodeValue = `${flowMeta.completeLabel} `;

    const entries = currentTaxInvoiceTab === 'issued' ? issuedEntries : draftEntries;
    const supplyTotal = entries.reduce((sum, item) => sum + Number(item.supplyAmount || 0), 0);
    const taxTotal = entries.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
    document.getElementById('taxInvoiceSummary').innerHTML = `
        <div class="summary-title">
            <span>${flowMeta.label} 월간 정산</span>
            <span>${entries.length}건</span>
        </div>
        <div class="summary-row"><span>공급가액</span><span class="summary-value">${supplyTotal.toLocaleString()} 원</span></div>
        <div class="summary-row"><span>부가세</span><span class="summary-value">${taxTotal.toLocaleString()} 원</span></div>
        <div class="summary-row total"><span>합계</span><span class="summary-value">${(supplyTotal + taxTotal).toLocaleString()} 원</span></div>`;

    const list = document.getElementById('taxInvoiceList');
    if (entries.length === 0) {
        const emptyDraft = currentTaxInvoiceFlow === 'sales'
            ? '계산서 발행 대상 거래처의 운행내역이 없습니다.'
            : currentTaxInvoiceFlow === 'purchase'
                ? '회사 매입 방식으로 설정된 기사의 운행내역이 없습니다.'
                : '기사 직접발행 방식으로 설정된 수수료 내역이 없습니다.';
        list.innerHTML = `<div class="tax-invoice-empty"><span class="tax-invoice-empty-mark" aria-hidden="true">–</span><strong>${currentTaxInvoiceTab === 'issued' ? `${flowMeta.completeLabel} 내역이 없습니다.` : emptyDraft}</strong><small>선택한 월의 운행 기록을 기준으로 표시됩니다.</small></div>`;
        return;
    }

    list.innerHTML = entries.map(item => {
        const partyKey = encodeURIComponent(item.partyKey || item.clientName).replace(/'/g, '%27');
        const missingInfo = !item.clientBizNumber;
        const driverBreakdown = item.partyType === 'driver'
            ? `<small class="tax-invoice-driver-breakdown">${escapeDetailText(item.carNumber || '')} · 운송료 ${Number(item.grossAmount || 0).toLocaleString()}원${item.commissionAmount ? ` · 수수료 ${Number(item.commissionAmount).toLocaleString()}원` : ''}${item.insuranceAmount ? ` · 산재보험 ${Number(item.insuranceAmount).toLocaleString()}원` : ''}</small>`
            : '';
        // 매출 발행(sales)은 이제 차량마다 공급 사업자가 다를 수 있어서, 카드에 "어느 차량/
        // 사업자의 매출인지"를 함께 보여준다(요구사항 19) — 같은 거래처라도 카드가 여러 장
        // 나뉘어 있으면 이 라벨로 구분한다. vehicleLabel에 이미 "사업자명 · 차량번호"가 포함돼
        // 있으므로(별도 사업자 차량의 경우) 이름을 또 붙이면 중복 표시된다.
        const supplierBreakdown = (item.partyType === 'client' && item.vehicleLabel)
            ? `<small class="tax-invoice-driver-breakdown">${escapeDetailText(item.vehicleLabel)}</small>`
            : '';
        const draftActionLabel = currentTaxInvoiceFlow === 'purchase' ? '내용 입력' : '작성하기';
        const cancelLabel = currentTaxInvoiceFlow === 'purchase' ? '수취 취소' : '발급 취소';
        return `<article class="tax-invoice-card">
            <div class="tax-invoice-card-head"><div><strong>${escapeDetailText(item.clientName)}</strong><span>${item.count || 0}건 · ${missingInfo ? '사업자번호 미입력' : escapeDetailText(item.clientBizNumber)}</span>${driverBreakdown}${supplierBreakdown}</div><em class="${item.status}">${item.status === 'issued' ? flowMeta.completeLabel : (currentTaxInvoiceFlow === 'purchase' ? '수취 전' : '작성 전')}</em></div>
            <div class="tax-invoice-card-money"><span>공급가액 <b>${Number(item.supplyAmount).toLocaleString()}원</b></span><span>세액 <b>${Number(item.taxAmount).toLocaleString()}원</b></span><strong><small>합계</small>${Number(item.totalAmount).toLocaleString()}원</strong></div>
            <div class="tax-invoice-card-actions">
                <button type="button" onclick="openTaxInvoiceDraft('${partyKey}')">${item.status === 'issued' ? '내용 보기' : draftActionLabel}</button>
                <button type="button" onclick="runSaveAction(this, 'tax-invoice-export-${partyKey}', () => exportTaxInvoiceCsv('${partyKey}'))">엑셀 저장</button>
                ${item.status === 'issued' ? `<button type="button" onclick="runSaveAction(this, 'tax-invoice-status-${partyKey}', () => changeTaxInvoiceStatus('${partyKey}', 'draft'))">${cancelLabel}</button>` : `<button type="button" class="primary" onclick="runSaveAction(this, 'tax-invoice-status-${partyKey}', () => changeTaxInvoiceStatus('${partyKey}', 'issued'))">${flowMeta.completeLabel}</button>`}
            </div>
        </article>`;
    }).join('');
}

function findCurrentTaxInvoice(partyKey, flow = currentTaxInvoiceFlow) {
    const group = getTaxInvoiceSourceGroups(taxInvoiceViewMonth, flow).find(item => item.partyKey === partyKey);
    if (group) return buildTaxInvoiceEntry(group, flow);
    return getTaxInvoiceRecords().find(item => item.id === getTaxInvoiceRecordId(taxInvoiceViewMonth, partyKey, flow));
}

function openTaxInvoiceDraft(encodedPartyKey) {
    const partyKey = decodeURIComponent(encodedPartyKey);
    const item = findCurrentTaxInvoice(partyKey);
    if (!item) return;
    const meta = getTaxInvoiceFlowMeta(item.flow);
    document.getElementById('taxInvoiceRecordId').value = item.id;
    document.getElementById('taxInvoiceRecordFlow').value = item.flow;
    document.getElementById('taxInvoicePartyKey').value = item.partyKey || partyKey;
    document.getElementById('taxInvoiceModalTitle').textContent = `${meta.label} 계산서`;
    document.getElementById('taxInvoicePartyHeading').textContent = meta.partyHeading;
    document.getElementById('taxInvoiceClientName').value = item.clientName;
    document.getElementById('taxInvoiceClientBizNumber').value = item.clientBizNumber || '';
    document.getElementById('taxInvoiceClientRepresentative').value = item.clientRepresentative || '';
    document.getElementById('taxInvoiceClientEmail').value = item.clientEmail || '';
    document.getElementById('taxInvoiceClientAddress').value = item.clientAddress || '';
    document.getElementById('taxInvoiceClientBizType').value = item.clientBizType || '';
    document.getElementById('taxInvoiceClientBizItem').value = item.clientBizItem || '';
    document.getElementById('taxInvoiceDate').value = item.issueDate || `${taxInvoiceViewMonth}-${String(new Date(Number(taxInvoiceViewMonth.slice(0,4)), Number(taxInvoiceViewMonth.slice(5,7)), 0).getDate()).padStart(2, '0')}`;
    document.getElementById('taxInvoiceItemName').value = item.itemName || meta.itemName;
    document.getElementById('taxInvoiceRemark').value = item.remark || '';
    document.getElementById('taxInvoiceSupplyAmount').textContent = `${Number(item.supplyAmount).toLocaleString()}원`;
    document.getElementById('taxInvoiceTaxAmount').textContent = `${Number(item.taxAmount).toLocaleString()}원`;
    document.getElementById('taxInvoiceTotalAmount').textContent = `${Number(item.totalAmount).toLocaleString()}원`;
    document.getElementById('taxInvoiceModal').classList.remove('hidden');
}

function closeTaxInvoiceModal() {
    document.getElementById('taxInvoiceModal').classList.add('hidden');
}

function collectTaxInvoiceForm() {
    const id = document.getElementById('taxInvoiceRecordId').value;
    const flow = document.getElementById('taxInvoiceRecordFlow').value || currentTaxInvoiceFlow;
    const partyKey = document.getElementById('taxInvoicePartyKey').value;
    const clientName = document.getElementById('taxInvoiceClientName').value;
    const current = findCurrentTaxInvoice(partyKey, flow);
    return {
        ...current,
        id,
        flow,
        partyKey,
        logId: current?.carNumber || 'fleet',
        monthKey: taxInvoiceViewMonth,
        clientName,
        clientBizNumber: document.getElementById('taxInvoiceClientBizNumber').value.trim(),
        clientRepresentative: document.getElementById('taxInvoiceClientRepresentative').value.trim(),
        clientEmail: document.getElementById('taxInvoiceClientEmail').value.trim(),
        clientAddress: document.getElementById('taxInvoiceClientAddress').value.trim(),
        clientBizType: document.getElementById('taxInvoiceClientBizType').value.trim(),
        clientBizItem: document.getElementById('taxInvoiceClientBizItem').value.trim(),
        issueDate: document.getElementById('taxInvoiceDate').value,
        itemName: document.getElementById('taxInvoiceItemName').value.trim() || getTaxInvoiceFlowMeta(flow).itemName,
        remark: document.getElementById('taxInvoiceRemark').value.trim(),
        status: current?.status || 'draft',
        updatedAt: new Date().toISOString()
    };
}

function persistTaxInvoice(item) {
    const records = getTaxInvoiceRecords();
    const index = records.findIndex(record => record.id === item.id);
    // 이미 로컬에 supabaseId가 붙어있던 기존 레코드라면 그대로 이어받는다 — 안 이어받으면
    // 업데이트해야 할 서버 행을 못 찾아서 매번 새 행으로 insert되는 사고로 이어진다.
    if (index >= 0) records[index] = { ...records[index], ...item };
    else records.push(item);
    saveTaxInvoiceRecords(records);
    // 세금계산서 작성/발급 상태를 클라우드에도 반영한다 — 로컬에만 저장하면 기기를 바꾸거나
    // 저장공간이 지워졌을 때 이 이력이 통째로 사라진다(실제로 그런 상태였다가 고침).
    if (typeof scheduleSupabaseTaxInvoiceSync === 'function') scheduleSupabaseTaxInvoiceSync(item.id);
}

function saveTaxInvoicePartyInfo(item) {
    const settings = getUserSettings();
    if (item.partyType === 'driver') {
        const car = (settings.cars || []).find(entry => entry.number === item.carNumber);
        if (!car) return;
        car.personalInfo = {
            ...(car.personalInfo || {}),
            name: item.clientRepresentative,
            bizNumber: item.clientBizNumber,
            email: item.clientEmail,
            address: item.clientAddress,
            bizType: item.clientBizType,
            bizItem: item.clientBizItem
        };
    } else {
        const client = (settings.clients || []).find(entry => entry.companyName === item.clientName);
        if (!client) return;
        client.bizNumber = item.clientBizNumber;
        client.taxRepresentative = item.clientRepresentative;
        client.taxEmail = item.clientEmail;
        client.taxAddress = item.clientAddress;
        client.taxBizType = item.clientBizType;
        client.taxBizItem = item.clientBizItem;
    }
    setUserSettings(settings);
}

function saveTaxInvoiceDraft() {
    const item = collectTaxInvoiceForm();
    if (!item.clientBizNumber) {
        markFieldError('taxInvoiceClientBizNumber');
        document.getElementById('taxInvoiceClientBizNumber').focus();
        return;
    }
    if (!item.issueDate) {
        markFieldError('taxInvoiceDate');
        document.getElementById('taxInvoiceDate').focus();
        return;
    }
    persistTaxInvoice(item);
    saveTaxInvoicePartyInfo(item);
    closeTaxInvoiceModal();
    renderTaxInvoices();
    showToastMessage('세금계산서 작성 내용을 저장했습니다.');
}

// 계산서의 실제 "공급자"(발행 주체) 정보를 돌려준다. 매출 발행(sales)은 §16~21에 따라
// 운행 차량마다 공급 사업자가 다를 수 있으므로 getTaxInvoiceSourceGroups()가 그룹에 미리
// 붙여둔 supplierBiz를 우선 쓴다(메인차량/‘동일’ 기사차량이면 자동으로 차주 기본 사업자와
// 같음). 기사 매입/수수료 발행(purchase/commission)은 기존 그대로 차주 기본 사업자 하나만
// 쓴다 — 이번 작업은 기사 정산 계산서와 섞지 않는다(요구사항 21).
function getTaxInvoiceSupplierBiz(item, settings = getUserSettings()) {
    if (item?.flow === 'sales' && item.supplierBiz) return item.supplierBiz;
    return { name: settings.bizName || '', bizNumber: settings.bizNumber || '', representative: settings.bizRepresentative || settings.userName || '', address: settings.bizAddress || '', bizType: settings.bizType || '', bizItem: settings.bizItem || '', email: settings.bizEmail || '' };
}

function changeTaxInvoiceStatus(encodedPartyKey, status) {
    const partyKey = decodeURIComponent(encodedPartyKey);
    const item = findCurrentTaxInvoice(partyKey);
    if (!item) return;
    if (status === 'issued') {
        const settings = getUserSettings();
        const supplierBiz = getTaxInvoiceSupplierBiz(item, settings);
        if (!supplierBiz.name || !supplierBiz.bizNumber || !supplierBiz.representative) {
            showConfirmModal(
                item.flow === 'sales' && item.supplierBiz && !item.supplierBiz.sameAsOwner
                    ? '먼저 차량 관리에서 이 차량의 사업자 정보를 입력해 주세요.'
                    : '먼저 개인정보에서 공급자 사업자 정보를 입력해 주세요.',
                null
            );
            return;
        }
        if (!item.clientBizNumber) {
            openTaxInvoiceDraft(encodedPartyKey);
            showToastMessage('사업자등록번호란이 입력이 안 되어 있어요. 먼저 입력해 주세요.');
            return;
        }
    }
    item.status = status;
    item.issuedAt = status === 'issued' ? new Date().toISOString() : '';
    persistTaxInvoice(item);
    renderTaxInvoices();
    showToastMessage(status === 'issued' ? `${getTaxInvoiceFlowMeta(item.flow).completeLabel}로 표시했습니다.` : '처리 전 상태로 되돌렸습니다.');
}

function loadTaxInvoiceExcelLibrary() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-tax-invoice-excel]');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.ExcelJS), { once:true });
            existing.addEventListener('error', reject, { once:true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        script.dataset.taxInvoiceExcel = 'true';
        script.onload = () => resolve(window.ExcelJS);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function exportTaxInvoiceCsv(encodedPartyKey) {
    const partyKey = decodeURIComponent(encodedPartyKey);
    const item = findCurrentTaxInvoice(partyKey);
    const settings = getUserSettings();
    // 매출 발행은 차량별 공급 사업자(§16~21)를 쓴다 — 항상 차주 기본 사업자만 확인하면
    // 다른 사업자로 설정된 기사차량의 계산서를 엉뚱하게 막게 된다.
    const resolvedSupplierBiz = item ? getTaxInvoiceSupplierBiz(item, settings) : null;
    if (!item || !resolvedSupplierBiz?.bizNumber || !item.clientBizNumber) {
        showConfirmModal('공급자와 공급받는 자의 사업자등록번호를 먼저 입력해 주세요.', null);
        return;
    }
    const companyParty = {
        bizNumber: resolvedSupplierBiz.bizNumber || '', name: resolvedSupplierBiz.name || '', representative: resolvedSupplierBiz.representative || '',
        address: resolvedSupplierBiz.address || '', bizType: resolvedSupplierBiz.bizType || '', bizItem: resolvedSupplierBiz.bizItem || '', email: resolvedSupplierBiz.email || ''
    };
    const otherParty = {
        bizNumber: item.clientBizNumber || '', name: item.clientName || '', representative: item.clientRepresentative || '',
        address: item.clientAddress || '', bizType: item.clientBizType || '', bizItem: item.clientBizItem || '', email: item.clientEmail || ''
    };
    const supplier = item.flow === 'purchase' ? otherParty : companyParty;
    const buyer = item.flow === 'purchase' ? companyParty : otherParty;
    const issueDate = item.issueDate || `${taxInvoiceViewMonth}-01`;
    const filename = `${taxInvoiceViewMonth}_${item.clientName}_${getTaxInvoiceFlowMeta(item.flow).label}_계산서.xlsx`.replace(/[\\/:*?"<>|]/g, '_');

    try {
        const ExcelJS = await loadTaxInvoiceExcelLibrary();
        const workbook = new ExcelJS.Workbook();
        workbook.creator = settings.bizName || '운행일지';
        workbook.created = new Date();
        workbook.subject = `${taxInvoiceViewMonth} ${item.itemName || getTaxInvoiceFlowMeta(item.flow).itemName}`;

        const sheet = workbook.addWorksheet('세금계산서', {
            pageSetup:{ paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:1, margins:{left:.25,right:.25,top:.35,bottom:.35,header:.1,footer:.1} },
            views:[{ showGridLines:false }]
        });
        const widths = [5,10,18,10,14,5,10,18,10,14];
        widths.forEach((width,index) => { sheet.getColumn(index + 1).width = width; });
        sheet.properties.defaultRowHeight = 21;
        sheet.pageSetup.printArea = 'A1:J19';

        const thinBlue = { style:'thin', color:{argb:'FF8EA9D6'} };
        const mediumBlue = { style:'medium', color:{argb:'FF365B9D'} };
        const allThin = { top:thinBlue,left:thinBlue,bottom:thinBlue,right:thinBlue };
        const supplierFill = 'FFFFFFFF';
        const supplierSectionFill = 'FFFFD9D9';
        const supplierLabelFill = 'FFFFF2F2';
        const buyerFill = 'FFFFFFFF';
        const buyerSectionFill = 'FFC2D9F2';
        const buyerLabelFill = 'FFF2F5FF';
        const headerFill = 'FFF1F3F7';
        const baseFont = { name:'맑은 고딕', size:10, color:{argb:'FF222222'} };

        sheet.mergeCells('A1:E2');
        sheet.getCell('A1').value = '전자세금계산서';
        sheet.getCell('A1').font = { ...baseFont, size:18, bold:true };
        sheet.getCell('A1').alignment = { horizontal:'center', vertical:'middle' };
        sheet.mergeCells('F1:G1'); sheet.getCell('F1').value = '승인번호';
        sheet.mergeCells('H1:J1'); sheet.getCell('H1').value = '홈택스 발급 후 입력';
        sheet.mergeCells('F2:G2'); sheet.getCell('F2').value = '작성 구분';
        sheet.mergeCells('H2:J2'); sheet.getCell('H2').value = Number(item.taxAmount) > 0 ? '일반 과세' : '면세';

        sheet.mergeCells('A3:A7'); sheet.getCell('A3').value = '공\n급\n자';
        sheet.mergeCells('F3:F7'); sheet.getCell('F3').value = '공\n급\n받\n는\n자';
        sheet.getCell('A3').fill = {type:'pattern',pattern:'solid',fgColor:{argb:supplierSectionFill}};
        sheet.getCell('F3').fill = {type:'pattern',pattern:'solid',fgColor:{argb:buyerSectionFill}};
        sheet.getCell('A3').font = { ...baseFont, bold:true, color:{argb:'FFCA3333'} };
        sheet.getCell('F3').font = { ...baseFont, bold:true, color:{argb:'FF2468A6'} };
        sheet.getCell('A3').alignment = sheet.getCell('F3').alignment = { horizontal:'center',vertical:'middle',wrapText:true };

        const setTaxCell = (address,value,fill,bold=false) => {
            const cell=sheet.getCell(address); cell.value=value; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};
            cell.font={...baseFont,bold}; cell.alignment={horizontal:bold?'center':'left',vertical:'middle',wrapText:true};
        };
        [3,4,5,6,7].forEach(row => {
            ['B','D'].forEach(col => setTaxCell(`${col}${row}`,'',supplierLabelFill,true));
            ['C','E'].forEach(col => setTaxCell(`${col}${row}`,'',supplierFill));
            ['G','I'].forEach(col => setTaxCell(`${col}${row}`,'',buyerLabelFill,true));
            ['H','J'].forEach(col => setTaxCell(`${col}${row}`,'',buyerFill));
        });
        setTaxCell('B3','등록번호',supplierLabelFill,true); setTaxCell('C3',supplier.bizNumber,supplierFill);
        setTaxCell('D3','종사업자\n번호',supplierLabelFill,true); setTaxCell('E3','',supplierFill);
        setTaxCell('B4','상호\n(법인명)',supplierLabelFill,true); setTaxCell('C4',supplier.name,supplierFill);
        setTaxCell('D4','대표자',supplierLabelFill,true); setTaxCell('E4',supplier.representative,supplierFill);
        setTaxCell('B5','사업장 주소',supplierLabelFill,true); sheet.mergeCells('C5:E5'); setTaxCell('C5',supplier.address,supplierFill);
        setTaxCell('B6','업태',supplierLabelFill,true); setTaxCell('C6',supplier.bizType,supplierFill);
        setTaxCell('D6','종목',supplierLabelFill,true); setTaxCell('E6',supplier.bizItem,supplierFill);
        setTaxCell('B7','이메일',supplierLabelFill,true); sheet.mergeCells('C7:E7'); setTaxCell('C7',supplier.email,supplierFill);

        setTaxCell('G3','등록번호',buyerLabelFill,true); setTaxCell('H3',buyer.bizNumber,buyerFill);
        setTaxCell('I3','종사업자\n번호',buyerLabelFill,true); setTaxCell('J3','',buyerFill);
        setTaxCell('G4','상호\n(법인명)',buyerLabelFill,true); setTaxCell('H4',buyer.name,buyerFill);
        setTaxCell('I4','대표자',buyerLabelFill,true); setTaxCell('J4',buyer.representative,buyerFill);
        setTaxCell('G5','사업장 주소',buyerLabelFill,true); sheet.mergeCells('H5:J5'); setTaxCell('H5',buyer.address,buyerFill);
        setTaxCell('G6','업태',buyerLabelFill,true); setTaxCell('H6',buyer.bizType,buyerFill);
        setTaxCell('I6','종목',buyerLabelFill,true); setTaxCell('J6',buyer.bizItem,buyerFill);
        setTaxCell('G7','이메일',buyerLabelFill,true); sheet.mergeCells('H7:J7'); setTaxCell('H7',buyer.email,buyerFill);
        sheet.mergeCells('A8:B8'); sheet.getCell('A8').value='작성일자';
        sheet.mergeCells('C8:D8'); sheet.getCell('C8').value='공급가액';
        sheet.mergeCells('E8:F8'); sheet.getCell('E8').value='세액';
        sheet.mergeCells('G8:J8'); sheet.getCell('G8').value='수정사유';
        sheet.mergeCells('A9:B9'); sheet.getCell('A9').value=issueDate;
        sheet.mergeCells('C9:D9'); sheet.getCell('C9').value=Number(item.supplyAmount);
        sheet.mergeCells('E9:F9'); sheet.getCell('E9').value=Number(item.taxAmount);
        sheet.mergeCells('G9:J9'); sheet.getCell('G9').value='';
        sheet.mergeCells('A10:B10'); sheet.getCell('A10').value='비고';
        const invoiceCar = item.carNumber
            ? (settings.cars || []).find(car => car.number === item.carNumber)
            : (settings.cars || []).find(car => car.type === 'main');
        const accountMemo = `${settings.bankName || '-'} ${settings.accountNumber || '-'} / ${settings.userName || '-'} / ${invoiceCar?.number || '-'}`;
        sheet.mergeCells('C10:J10'); sheet.getCell('C10').value=accountMemo;

        ['A11','B11','C11','D11','E11','F11','H11','I11','J11'].forEach((address,index) => {
            sheet.getCell(address).value = ['월','일','품목','규격','수량','단가','공급가액','세액','비고'][index];
        });
        sheet.mergeCells('F11:G11');
        const [year,month,day] = issueDate.split('-');
        sheet.getRow(12).values = [month,day,item.itemName || '화물운송료','',1,Number(item.supplyAmount),'',Number(item.supplyAmount),Number(item.taxAmount),item.remark || ''];
        sheet.mergeCells('F12:G12');
        for (let row=13; row<=16; row++) { sheet.getRow(row).values = ['','','','','','','','','','']; sheet.mergeCells(`F${row}:G${row}`); }

        sheet.mergeCells('A17:B17'); sheet.getCell('A17').value='합계금액';
        sheet.getCell('C17').value='현금'; sheet.getCell('D17').value='수표'; sheet.getCell('E17').value='어음';
        sheet.mergeCells('F17:G17'); sheet.getCell('F17').value='외상미수금';
        sheet.mergeCells('H17:J17'); sheet.getCell('H17').value='청구 구분';
        sheet.mergeCells('A18:B18'); sheet.getCell('A18').value=Number(item.totalAmount);
        sheet.getCell('C18').value=''; sheet.getCell('D18').value=''; sheet.getCell('E18').value='';
        sheet.mergeCells('F18:G18'); sheet.getCell('F18').value=Number(item.totalAmount);
        sheet.mergeCells('H18:J18'); sheet.getCell('H18').value='이 금액을 청구함';
        sheet.mergeCells('A19:J19'); sheet.getCell('A19').value='※ 본 문서는 세금계산서 작성 및 확인을 위한 자료입니다. 실제 발급 여부는 홈택스에서 확인해 주세요.';

        for (let row=1; row<=19; row++) {
            for (let col=1; col<=10; col++) {
                const cell = sheet.getCell(row,col);
                cell.border = allThin;
                if (!cell.font || !cell.font.name) cell.font = baseFont;
                cell.alignment = { ...(cell.alignment || {}), vertical:'middle', wrapText:true };
            }
        }
        for (let col=1; col<=10; col++) {
            sheet.getCell(1,col).border = { ...sheet.getCell(1,col).border, top:mediumBlue };
            sheet.getCell(19,col).border = { ...sheet.getCell(19,col).border, bottom:mediumBlue };
        }
        for (let row=1; row<=19; row++) {
            sheet.getCell(row,1).border = { ...sheet.getCell(row,1).border, left:mediumBlue };
            sheet.getCell(row,10).border = { ...sheet.getCell(row,10).border, right:mediumBlue };
        }
        const supplierBorder = { style:'thin', color:{argb:'FFFFD9D9'} };
        const buyerBorder = { style:'thin', color:{argb:'FFC2D9F2'} };
        const supplierOuterBorder = { style:'medium', color:{argb:'FFFFD9D9'} };
        const buyerOuterBorder = { style:'medium', color:{argb:'FFC2D9F2'} };
        for (let row=3; row<=7; row++) {
            for (let col=1; col<=5; col++) sheet.getCell(row,col).border={top:supplierBorder,left:supplierBorder,bottom:supplierBorder,right:supplierBorder};
            for (let col=6; col<=10; col++) sheet.getCell(row,col).border={top:buyerBorder,left:buyerBorder,bottom:buyerBorder,right:buyerBorder};
            sheet.getCell(row,1).border={...sheet.getCell(row,1).border,left:supplierOuterBorder};
            sheet.getCell(row,5).border={...sheet.getCell(row,5).border,right:supplierOuterBorder};
            sheet.getCell(row,6).border={...sheet.getCell(row,6).border,left:buyerOuterBorder};
            sheet.getCell(row,10).border={...sheet.getCell(row,10).border,right:buyerOuterBorder};
        }
        for (let col=1; col<=5; col++) {
            sheet.getCell(3,col).border={...sheet.getCell(3,col).border,top:supplierOuterBorder};
            sheet.getCell(7,col).border={...sheet.getCell(7,col).border,bottom:supplierOuterBorder};
        }
        for (let col=6; col<=10; col++) {
            sheet.getCell(3,col).border={...sheet.getCell(3,col).border,top:buyerOuterBorder};
            sheet.getCell(7,col).border={...sheet.getCell(7,col).border,bottom:buyerOuterBorder};
        }
        /* 표 전체 오른쪽 외곽선: J열과 K열 사이의 진한 파란색 굵은 선을 끝까지 유지한다. */
        for (let row=1; row<=19; row++) {
            sheet.getCell(row,10).border={...sheet.getCell(row,10).border,right:mediumBlue};
        }
        ['B3','D3','B4','D4','B5','B6','D6','B7'].forEach(address => {
            sheet.getCell(address).font={...baseFont,bold:true,color:{argb:'FFAF5F5F'}};
        });
        ['G3','I3','G4','I4','G5','G6','I6','G7'].forEach(address => {
            sheet.getCell(address).font={...baseFont,bold:true,color:{argb:'FF3A77A2'}};
        });
        [8,11,17].forEach(row => {
            sheet.getRow(row).eachCell({includeEmpty:true}, cell => {
                cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:headerFill}};
                cell.font={...baseFont,bold:true}; cell.alignment={horizontal:'center',vertical:'middle'};
            });
        });
        [1,2].forEach(row => {
            for (let col=1; col<=10; col++) sheet.getCell(row,col).fill={type:'pattern',pattern:'solid',fgColor:{argb:headerFill}};
        });
        ['F1','F2','A8','C8','E8','G8','A10','A11','B11','C11','D11','E11','F11','H11','I11','J11','A17','C17','D17','E17','F17','H17'].forEach(address => {
            sheet.getCell(address).alignment={horizontal:'center',vertical:'middle',wrapText:true};
            sheet.getCell(address).font={...baseFont,bold:true};
        });
        ['C9','E9','F12','H12','I12','A18','F18'].forEach(address => {
            sheet.getCell(address).numFmt='#,##0'; sheet.getCell(address).alignment={horizontal:'right',vertical:'middle'};
        });
        sheet.getCell('H18').font={...baseFont,bold:true}; sheet.getCell('H18').alignment={horizontal:'center',vertical:'middle'};
        sheet.getCell('A19').font={...baseFont,size:8,color:{argb:'FF777777'}}; sheet.getCell('A19').alignment={horizontal:'center',vertical:'middle'};
        sheet.getRow(1).height=25; sheet.getRow(2).height=25; sheet.getRow(3).height=32; sheet.getRow(4).height=32; sheet.getRow(5).height=34; sheet.getRow(19).height=24;

        const uploadSheet = workbook.addWorksheet('입력자료', {views:[{state:'frozen',ySplit:1}]});
        const uploadHeaders = ['작성일자','공급자등록번호','공급자상호','공급자대표자','공급자주소','공급자업태','공급자종목','공급자이메일','공급받는자등록번호','공급받는자상호','공급받는자대표자','공급받는자주소','공급받는자업태','공급받는자종목','공급받는자이메일','품목','수량','공급가액','세액','합계금액','비고'];
        const uploadRow = [issueDate,supplier.bizNumber,supplier.name,supplier.representative,supplier.address,supplier.bizType,supplier.bizItem,supplier.email,buyer.bizNumber,buyer.name,buyer.representative,buyer.address,buyer.bizType,buyer.bizItem,buyer.email,item.itemName || getTaxInvoiceFlowMeta(item.flow).itemName,1,Number(item.supplyAmount),Number(item.taxAmount),Number(item.totalAmount),item.remark];
        uploadSheet.addRow(uploadHeaders); uploadSheet.addRow(uploadRow);
        uploadSheet.getRow(1).font={name:'맑은 고딕',size:10,bold:true,color:{argb:'FFFFFFFF'}};
        uploadSheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF365B9D'}};
        uploadSheet.columns.forEach((column,index) => { column.width=index===0?13:18; });
        [18,19,20].forEach(col => { uploadSheet.getCell(2,col).numFmt='#,##0'; });

        const buffer = await workbook.xlsx.writeBuffer();
        const url = URL.createObjectURL(new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
        const link = document.createElement('a'); link.href=url; link.download=filename;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url),1000);
        showToastMessage('세금계산서 엑셀 파일을 저장했습니다.');
    } catch (error) {
        console.error('세금계산서 엑셀 저장 실패:', error);
        throw error;
    }
}

function openClientModal(index = -1) {
    editingClientIndex = index;
    const settings = getUserSettings();
    const clients = settings.clients || [];

    if (index >= 0 && clients[index]) {
        const client = clients[index];

        document.getElementById('clientModalTitle').textContent = '거래처 수정';
        document.getElementById('clientCompanyName').value = client.companyName || '';
        document.getElementById('clientManagerName').value = client.managerName || '';
        document.getElementById('clientTaxRepresentative').value = client.taxRepresentative || client.managerName || '';
        document.getElementById('clientBizNumber').value = client.bizNumber || '';
        document.getElementById('clientPhone').value = client.phone || '';
        document.getElementById('clientTaxBizType').value = client.taxBizType || '';
        document.getElementById('clientTaxBizItem').value = client.taxBizItem || '';
        document.getElementById('clientTaxAddress').value = client.taxAddress || '';
        document.getElementById('clientTaxEmail').value = client.taxEmail || '';

        document.getElementById('clientPinnedToggle').checked = !!client.isPinned;
        updateClientFavoriteStarUI();

        document.getElementById('clientCommToggle').checked = !!client.commEnabled;
        setClientCommType(client.commType || 'percent');
        document.getElementById('clientCommValue').value = client.commValue || '';
        toggleClientComm();

        document.getElementById('clientFixedRouteToggle').checked = !!client.fixedRouteLinked;
        document.getElementById('clientFixedUnitPrice').value = client.fixedUnitPrice || '';
        toggleClientFixedRoute();

        document.getElementById('clientPalletToggle').checked = !!client.palletOn;
        document.getElementById('clientPalletPrice').value = client.palletPrice || '';
        toggleClientPallet();

        const savedPaymentTerm = client.paymentTerm || 'next_month_end';
        document.getElementById('clientPaymentTerm').value = savedPaymentTerm === 'second_month_end' ? 'second_month_day' : savedPaymentTerm;
        document.getElementById('clientPaymentTermValue').value = savedPaymentTerm === 'second_month_end' ? '31' : (client.paymentTermValue || '');
    } else {
        document.getElementById('clientModalTitle').textContent = '거래처 등록';
        document.getElementById('clientCompanyName').value = '';
        document.getElementById('clientManagerName').value = '';
        document.getElementById('clientTaxRepresentative').value = '';
        document.getElementById('clientBizNumber').value = '';
        document.getElementById('clientPhone').value = '';
        document.getElementById('clientTaxBizType').value = '';
        document.getElementById('clientTaxBizItem').value = '';
        document.getElementById('clientTaxAddress').value = '';
        document.getElementById('clientTaxEmail').value = '';

        document.getElementById('clientPinnedToggle').checked = false;
        updateClientFavoriteStarUI();

        document.getElementById('clientCommToggle').checked = false;
        setClientCommType('percent');
        document.getElementById('clientCommValue').value = '';
        toggleClientComm();

        document.getElementById('clientFixedRouteToggle').checked = false;
        document.getElementById('clientFixedUnitPrice').value = '';
        toggleClientFixedRoute();

        document.getElementById('clientPalletToggle').checked = false;
        document.getElementById('clientPalletPrice').value = '';
        toggleClientPallet();

        document.getElementById('clientPaymentTerm').value = 'next_month_end';
        document.getElementById('clientPaymentTermValue').value = '';
    }

    document.getElementById('clientPaymentTerm').parentElement?._dropdownSync?.();

    updateClientPaymentTermControls();
    updateClientPaymentTermGuide();
    document.getElementById('clientModal').classList.remove('hidden');
}

function saveClient() {
    const companyName = document.getElementById('clientCompanyName').value.trim();
    const managerName = document.getElementById('clientManagerName').value.trim();
    const bizNumber = document.getElementById('clientBizNumber').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const taxRepresentative = document.getElementById('clientTaxRepresentative').value.trim();
    const taxEmail = document.getElementById('clientTaxEmail').value.trim();
    const taxAddress = document.getElementById('clientTaxAddress').value.trim();
    const taxBizType = document.getElementById('clientTaxBizType').value.trim();
    const taxBizItem = document.getElementById('clientTaxBizItem').value.trim();
    const isPinned = document.getElementById('clientPinnedToggle').checked;
    // 수수료는 이제 즐겨찾기와 무관하게 항상 켤 수 있다(예전엔 즐겨찾기 켰을 때만 가능했음).
    const commEnabled = document.getElementById('clientCommToggle').checked;
    const commType = document.getElementById('clientCommType').value;
    const commValue = document.getElementById('clientCommValue').value.trim();
    const fixedRouteLinked = document.getElementById('clientFixedRouteToggle').checked;
    const fixedUnitPrice = document.getElementById('clientFixedUnitPrice').value.trim();
    const palletOn = document.getElementById('clientPalletToggle').checked;
    const palletPrice = document.getElementById('clientPalletPrice').value.trim();
    const paymentTerm = document.getElementById('clientPaymentTerm').value;
    const paymentTermValue = document.getElementById('clientPaymentTermValue').value.trim();

    if (!companyName) {
        markFieldError('clientCompanyName');
        document.getElementById('clientCompanyName').focus();
        return;
    }

    if (commEnabled && !commValue) {
        markFieldError('clientCommValue');
        document.getElementById('clientCommValue').focus();
        return;
    }

    if (fixedRouteLinked && !fixedUnitPrice) {
        markFieldError('clientFixedUnitPrice');
        document.getElementById('clientFixedUnitPrice').focus();
        return;
    }

    if (palletOn && !palletPrice) {
        markFieldError('clientPalletPrice');
        document.getElementById('clientPalletPrice').focus();
        return;
    }

    if ((paymentTerm === 'next_month_day' || paymentTerm === 'second_month_day') && (!paymentTermValue || parseInt(paymentTermValue, 10) < 1 || parseInt(paymentTermValue, 10) > 31)) {
        markFieldError('clientPaymentTermValue');
        document.getElementById('clientPaymentTermValue').focus();
        return;
    }

    if (paymentTerm === 'after_days' && paymentTermValue === '') {
        markFieldError('clientPaymentTermValue');
        document.getElementById('clientPaymentTermValue').focus();
        return;
    }

    const settings = getUserSettings();

    if (!settings.clients) {
        settings.clients = [];
    }

    const previousClient = editingClientIndex >= 0 ? (settings.clients[editingClientIndex] || {}) : {};
    const clientData = {
        ...previousClient,
        // 거래처명과 무관한 고유 id. 수정 시에는 기존 id를 그대로 유지하고, 신규 등록일 때만
        // 새로 생성한다 — 운행 기록에 저장되는 clientId/commissionSnapshot이 이 id를 참조한다.
        id: previousClient.id || generateLocalId('client'),
        companyName,
        managerName,
        bizNumber,
        phone,
        taxRepresentative,
        taxEmail,
        taxAddress,
        taxBizType,
        taxBizItem,
        isPinned,
        commEnabled,
        commType,
        commValue,
        fixedRouteLinked,
        fixedUnitPrice,
        palletOn,
        palletPrice,
        paymentTerm,
        paymentTermValue
    };

    if (editingClientIndex >= 0) {
        settings.clients[editingClientIndex] = clientData;
        showToastMessage('수정했습니다.');
    } else {
        settings.clients.push(clientData);
        showToastMessage('등록했습니다.');
    }

    // 고정노선 연동은 계정 전체에서 거래처 1곳만 가능하다 — 지금 저장한 거래처를 켰다면
    // 나머지 거래처는 전부 자동으로 끈다(하루치 고정노선 운행횟수가 숫자 하나뿐이라, 두
    // 거래처가 동시에 연동되면 어느 쪽 몫인지 구분할 방법이 없기 때문).
    if (fixedRouteLinked) {
        settings.clients.forEach(client => {
            if (client.id !== clientData.id) client.fixedRouteLinked = false;
        });
    }

    setUserSettings(settings);
    closeClientModal();
    renderClientList();
    buildCalendar();

    if (clientModalOpenedFromCallDetail) {
        clientModalOpenedFromCallDetail = false;
        populateClientDataList();
        renderPinnedClientShortcuts();
        const callClientInput = document.getElementById('callClient');
        if (callClientInput) {
            callClientInput.value = companyName;
            calculateCallDetailComm();
            applyClientPaymentTerms();
        }
    }
}