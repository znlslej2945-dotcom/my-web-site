const appState = {
    viewDate: new Date(),
    maintViewDate: new Date(),
    fuelViewDate: new Date(),
    selectedDateKey: null,
    activeLogId: 'main',
    workData: JSON.parse(localStorage.getItem('workData')) || {},
    previousPage: 'main',
    isOffSelected: false,
    currentTempMaintItems: [],
    currentTempCallDetails: [],
    currentTempFuelItems: [],
    isDetailReportView: false,
    currentDetailClientFilter: 'ALL',
    calendarCells: [],
    confirmCallback: null
};

// 기존 변수명과의 호환성을 위한 참조 바인딩 (다른 함수들의 대규모 수정 최소화)
let viewDate = appState.viewDate;
let maintViewDate = appState.maintViewDate;
let fuelViewDate = appState.fuelViewDate;
let selectedDateKey = appState.selectedDateKey;
let activeLogId = appState.activeLogId;
let workData = appState.workData;
let previousPage = appState.previousPage;
let isOffSelected = appState.isOffSelected;
let currentTempMaintItems = appState.currentTempMaintItems;
let currentTempCallDetails = appState.currentTempCallDetails;
let currentTempFuelItems = appState.currentTempFuelItems;
let isDetailReportView = appState.isDetailReportView;
let currentDetailClientFilter = appState.currentDetailClientFilter;
const calendarCells = appState.calendarCells;
let confirmCallback = appState.confirmCallback;
let pendingAccountType = '';
let accountTypeReturnPage = 'login';
let driverConnectionReturnPage = 'main';
let activeLinkedDriverId = '';

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

function getActiveLogSettings() {
    const settings = getUserSettings();
    if (activeLogId === 'main') return settings;

    return {
        ...settings,
        inputMode: settings.subInputMode,
        fixedOn: settings.subFixedOn,
        unitPrice: settings.subUnitPrice,
        palletOn: settings.subPalletOn,
        palletPrice: settings.subPalletPrice,
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
}

function getAccountTypeMeta(type) {
    const types = {
        owner_driver: {
            label: '개인 차주(1인)',
            description: '내 차량을 직접 운행하고 연결 기사를 조회·관리합니다.',
            icon: '<svg viewBox="0 0 24 24"><path d="M3 14.5v-2l2.5-1.4 1.6-3.7A2.3 2.3 0 0 1 9.2 6h5.6a2.3 2.3 0 0 1 2.1 1.4l1.6 3.7 2.5 1.4v4.2"></path><path d="M5 18h14M6 11h12"></path><circle cx="6.8" cy="17.5" r="2.5"></circle><circle cx="17.2" cy="17.5" r="2.5"></circle></svg>'
        },
        operator: {
            label: '운송사·운영 사장',
            description: '기사 초대, 차량 할당과 운행 기록 조회를 관리합니다.',
            icon: '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V8l7-4 7 4v13"></path><path d="M9 21v-5h6v5M8 11h2M14 11h2"></path></svg>'
        },
        employed_driver: {
            label: '소속 기사',
            description: '초대 코드나 전화번호로 소속 사장님과 연결합니다.',
            icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"></circle><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"></path><path d="M9 21v-4h6v4"></path></svg>'
        }
    };
    return types[type] || { label: '유형 미선택', description: '사용자 유형을 선택해 주세요.', icon: '' };
}

function isOwnerAccountType(type) {
    return type === 'owner_driver' || type === 'operator';
}

function showAccountTypePage(returnPage = 'login') {
    accountTypeReturnPage = returnPage === 'personal' ? 'personal' : 'login';
    const settings = getUserSettings();
    pendingAccountType = settings.accountType || '';
    hideAllPages();
    document.body.classList.add('account-flow-active');
    document.getElementById('accountTypePage').classList.remove('hidden');
    document.getElementById('accountTypeBackBtn')?.classList.toggle('hidden', accountTypeReturnPage !== 'personal');
    document.querySelectorAll('.account-type-option').forEach(button => {
        const selected = button.dataset.accountType === pendingAccountType;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-checked', String(selected));
    });
    const continueButton = document.getElementById('accountTypeContinueBtn');
    if (continueButton) continueButton.disabled = !pendingAccountType;
}

function selectAccountType(type) {
    if (!getAccountTypeMeta(type).label || !['owner_driver', 'operator', 'employed_driver'].includes(type)) return;
    pendingAccountType = type;
    document.querySelectorAll('.account-type-option').forEach(button => {
        const selected = button.dataset.accountType === type;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-checked', String(selected));
    });
    const continueButton = document.getElementById('accountTypeContinueBtn');
    if (continueButton) continueButton.disabled = false;
}

function continueAccountTypeSelection() {
    if (!pendingAccountType) {
        showToastMessage('사용자 유형을 선택해 주세요.');
        return;
    }
    const settings = getUserSettings();
    settings.accountType = pendingAccountType;
    settings.driverType = pendingAccountType;
    setUserSettings(settings);
    updateAccountRoleUI();

    if (accountTypeReturnPage === 'personal') {
        showPersonalInfo(personalInfoReturnPage);
    } else {
        showLocalLoginPage();
    }
}

function cancelAccountTypeSelection() {
    if (accountTypeReturnPage === 'personal') {
        showPersonalInfo(personalInfoReturnPage);
    } else {
        showLocalLoginPage();
    }
}

function showLocalLoginPage() {
    const settings = getUserSettings();
    if (!settings.accountType) {
        showAccountTypePage('login');
        return;
    }
    const meta = getAccountTypeMeta(settings.accountType);
    hideAllPages();
    document.body.classList.add('account-flow-active');
    document.getElementById('loginPage').classList.remove('hidden');
    const selectedType = document.getElementById('loginSelectedAccountType');
    if (selectedType) selectedType.innerHTML = `<span>${meta.icon}</span><span><strong>${meta.label}</strong><small>${meta.description}</small></span>`;
    document.getElementById('loginUserName').value = settings.userName || '';
    document.getElementById('loginUserPhone').value = settings.userPhone || '';
}

function completeLocalLogin() {
    const name = document.getElementById('loginUserName')?.value.trim() || '';
    const phone = document.getElementById('loginUserPhone')?.value.trim() || '';
    if (!name || phone.replace(/\D/g, '').length < 10) {
        showToastMessage('이름과 휴대전화 번호를 확인해 주세요.');
        return;
    }
    const settings = getUserSettings();
    settings.userName = name;
    settings.userPhone = phone;
    settings.isLoggedIn = true;
    settings.onboardingCompleted = true;
    setUserSettings(settings);
    loadSettings();
    updateAccountRoleUI();
    renderSubCarMenu();
    showMain();
    showToastMessage('로그인되었습니다.');
}

function requestAccountTypeChange() {
    const settings = getUserSettings();
    const hasOwnerLinks = isOwnerAccountType(settings.accountType)
        && (settings.driverLinks || []).some(link => link.status === 'linked' || link.status === 'pending');
    const hasEmployerLink = settings.accountType === 'employed_driver' && settings.employerLink?.status === 'linked';
    if (hasOwnerLinks || hasEmployerLink) {
        showConfirmModal('사용자 유형을 변경하려면 현재 기사 또는 소속 연동을 먼저 해제해 주세요.', null);
        return;
    }
    showAccountTypePage('personal');
}

function updateAccountRoleUI() {
    const settings = getUserSettings();
    const meta = getAccountTypeMeta(settings.accountType);
    const roleLabel = document.getElementById('personalAccountTypeLabel');
    const roleDescription = document.getElementById('personalAccountTypeDescription');
    const roleIcon = document.getElementById('personalAccountTypeIcon');
    if (roleLabel) roleLabel.textContent = meta.label;
    if (roleDescription) roleDescription.textContent = meta.description;
    if (roleIcon) roleIcon.innerHTML = meta.icon;

    const ownerRole = isOwnerAccountType(settings.accountType);
    document.getElementById('ownerDriverLinkSummaryCard')?.classList.toggle('hidden', !ownerRole);
    document.getElementById('employedDriverLinkCard')?.classList.toggle('hidden', settings.accountType !== 'employed_driver');
    document.getElementById('driverConnectionMenuBtn')?.classList.toggle('hidden', !ownerRole);

    const activeLinkCount = (settings.driverLinks || []).filter(link => link.status === 'linked').length;
    const countElement = document.getElementById('personalLinkedDriverCount');
    if (countElement) countElement.textContent = `${activeLinkCount}명`;

    const loginButton = document.getElementById('personalLoginBtn');
    const logoutButton = document.getElementById('personalLogoutBtn');
    loginButton?.classList.toggle('hidden', !!settings.isLoggedIn);
    logoutButton?.classList.toggle('hidden', !settings.isLoggedIn);
    renderEmployedDriverLinkState();
}

function showConfirmModal(msg, callback) {
    document.getElementById('confirmModalText').innerText = msg;
    confirmCallback = callback;
    document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
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

function generateLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateDriverInviteCode() {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const input = document.getElementById('linkedDriverInviteCode');
    if (input) input.value = code;
}

function populateLinkedDriverVehicleOptions() {
    const datalist = document.getElementById('linkedDriverVehicleOptions');
    if (!datalist) return;
    const cars = getUserSettings().cars || [];
    datalist.innerHTML = cars
        .filter(car => car.number)
        .map(car => `<option value="${escapeDetailText(car.number)}"></option>`)
        .join('');
}

function showDriverConnectionManagement(returnPage = 'main') {
    const settings = getUserSettings();
    if (!isOwnerAccountType(settings.accountType)) {
        showConfirmModal('개인 차주 또는 운송사·운영 사장 유형에서 사용할 수 있습니다.', null);
        return;
    }
    driverConnectionReturnPage = returnPage === 'personal' ? 'personal' : 'main';
    hideAllPages();
    document.getElementById('driverConnectionManagementPage').classList.remove('hidden');
    populateLinkedDriverVehicleOptions();
    renderLinkedDriverList();
    setActiveNav(driverConnectionReturnPage === 'personal' ? 'personal' : 'main');
}

function goBackFromDriverConnectionManagement() {
    if (driverConnectionReturnPage === 'personal') showPersonalInfo(personalInfoReturnPage);
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
}

function saveLinkedDriverInvitation() {
    const name = document.getElementById('linkedDriverName')?.value.trim() || '';
    const phone = document.getElementById('linkedDriverPhone')?.value.trim() || '';
    const inviteCode = document.getElementById('linkedDriverInviteCode')?.value.trim() || '';
    const vehicleNumber = document.getElementById('linkedDriverVehicle')?.value.trim() || '';
    const assignmentStart = document.getElementById('linkedDriverAssignmentStart')?.value || '';
    const assignmentEnd = document.getElementById('linkedDriverAssignmentEnd')?.value || '';
    const editId = document.getElementById('linkedDriverEditId')?.value || '';

    if (!name || !vehicleNumber || !assignmentStart || (!phone && !inviteCode)) {
        showToastMessage('기사, 연결 수단, 차량과 시작일을 입력해 주세요.');
        return;
    }
    if (assignmentEnd && assignmentEnd < assignmentStart) {
        showToastMessage('할당 종료일은 시작일 이후로 선택해 주세요.');
        return;
    }

    const settings = getUserSettings();
    const links = Array.isArray(settings.driverLinks) ? settings.driverLinks : [];
    const existingIndex = links.findIndex(link => link.id === editId);
    const previous = existingIndex >= 0 ? links[existingIndex] : null;
    const nextLink = {
        ...(previous || {}),
        id: previous?.id || generateLocalId('driver'),
        driverName: name,
        phone,
        inviteCode,
        vehicleNumber,
        assignmentStart,
        assignmentEnd,
        status: previous?.status === 'linked' ? 'linked' : 'pending',
        updatedAt: new Date().toISOString(),
        createdAt: previous?.createdAt || new Date().toISOString()
    };

    if (existingIndex >= 0) links[existingIndex] = nextLink;
    else links.push(nextLink);
    settings.driverLinks = links;
    setUserSettings(settings);
    resetLinkedDriverForm();
    renderLinkedDriverList();
    renderSubCarMenu();
    updateAccountRoleUI();
    showToastMessage(existingIndex >= 0 ? '기사 할당 정보를 수정했습니다.' : '기사 초대를 저장했습니다.');
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
    document.querySelector('.driver-invite-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
}

function completeLinkedDriverConnection(encodedId) {
    updateLinkedDriverStatus(decodeURIComponent(encodedId), 'linked', '기사 연결을 완료했습니다.');
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
        settings.driverLinks = (settings.driverLinks || []).filter(link => link.id !== id);
        setUserSettings(settings);
        renderLinkedDriverList();
        renderSubCarMenu();
        updateAccountRoleUI();
        showToastMessage('기사 연결 항목을 삭제했습니다.');
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
            actions = `<button type="button" class="primary" onclick="completeLinkedDriverConnection('${encodedId}')">연결 완료</button><button type="button" onclick="editLinkedDriver('${encodedId}')">초대 수정</button><button type="button" class="danger" onclick="disconnectLinkedDriver('${encodedId}')">초대 취소</button>`;
        } else if (link.status === 'linked') {
            actions = `<button type="button" class="primary" onclick="showLinkedDriverManagement('${encodedId}', true)">기록 조회</button><button type="button" onclick="editLinkedDriver('${encodedId}')">할당 변경</button><button type="button" class="danger" onclick="disconnectLinkedDriver('${encodedId}')">연동 해제</button>`;
        } else {
            actions = `<button type="button" onclick="renewLinkedDriverInvitation('${encodedId}')">다시 초대</button><button type="button" onclick="editLinkedDriver('${encodedId}')">정보 수정</button><button type="button" class="danger" onclick="deleteLinkedDriver('${encodedId}')">삭제</button>`;
        }
        return `<article class="linked-driver-card"><div class="linked-driver-card-head"><div><strong>${escapeDetailText(link.driverName || '기사')}</strong><span>${escapeDetailText(connection || '연결 정보 없음')}</span></div><em class="${link.status}">${statusLabel}</em></div><div class="linked-driver-assignment"><span><small>할당 차량</small><b>${escapeDetailText(link.vehicleNumber || '-')}</b></span><span><small>할당 기간</small><b>${escapeDetailText(period)}</b></span></div><div class="linked-driver-state ${assignment.key}">${assignment.label}</div><div class="linked-driver-card-actions">${actions}</div></article>`;
    }).join('');
}

function getLinkedDriverRecordData(link) {
    const connectionKey = link.inviteCode || String(link.phone || '').replace(/\D/g, '');
    const storageKeys = [
        connectionKey ? `linkedDriverWorkData_${connectionKey}` : '',
        `linkedDriverWorkData_${link.id}`,
        `workData_${link.vehicleNumber}`
    ].filter(Boolean);
    for (const key of storageKeys) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            if (value && typeof value === 'object') return value;
        } catch (error) {
            console.warn('연동 기사 기록 불러오기 실패:', error);
        }
    }
    return {};
}

function getLinkedRecordSummary(record) {
    const details = Array.isArray(record?.callDetails) ? record.callDetails : [];
    const fixedCount = Number(record?.fixedCount || record?.count || 0);
    const detailFare = details.reduce((sum, item) => sum + parseCurrencyValue(item?.fare), 0);
    const directFare = parseCurrencyValue(record?.fare || record?.fixedFare || record?.totalFare);
    const count = fixedCount + details.length || (record && Object.keys(record).length ? 1 : 0);
    return { details, count, fare: detailFare + directFare };
}

function showLinkedDriverManagement(id, encoded = false) {
    const linkId = encoded ? decodeURIComponent(id) : id;
    const link = getLinkedDriverById(linkId);
    if (!link || link.status !== 'linked') {
        showToastMessage('연동 중인 기사 정보를 찾을 수 없습니다.');
        return;
    }
    activeLinkedDriverId = link.id;
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
}

function renderLinkedDriverRecords() {
    const link = getLinkedDriverById(activeLinkedDriverId);
    const list = document.getElementById('linkedDriverRecordList');
    if (!link || !list) return;
    const month = document.getElementById('linkedDriverRecordMonth')?.value || '';
    const data = getLinkedDriverRecordData(link);
    const records = Object.entries(data)
        .filter(([dateKey]) => !month || dateKey.startsWith(month))
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dateKey, record]) => ({ dateKey, record, summary: getLinkedRecordSummary(record) }));
    const totalCount = records.reduce((sum, item) => sum + item.summary.count, 0);
    const totalFare = records.reduce((sum, item) => sum + item.summary.fare, 0);
    document.getElementById('linkedDriverRecordCount').textContent = `${totalCount}건`;
    document.getElementById('linkedDriverRecordFare').textContent = `${totalFare.toLocaleString()}원`;

    if (!records.length) {
        list.innerHTML = '<div class="linked-driver-empty">선택한 달에 작성된 운행 기록이 없습니다.</div>';
        return;
    }
    list.innerHTML = records.map(({ dateKey, summary }) => {
        const [, monthPart, dayPart] = dateKey.split('-');
        const routes = summary.details.slice(0, 2).map(item => `${item.loadLoc || '상차지'} → ${item.unloadLoc || '하차지'}`);
        return `<article class="linked-driver-record-card"><div><strong>${parseInt(monthPart, 10)}월 ${parseInt(dayPart, 10)}일</strong><span>${summary.count}건 운행</span></div>${routes.length ? `<p>${routes.map(route => escapeDetailText(route)).join('<br>')}</p>` : '<p>운행 기록</p>'}<b>${summary.fare.toLocaleString()}원</b></article>`;
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
}

function connectEmployedDriver() {
    const inviteCode = document.getElementById('employerInviteCode')?.value.trim() || '';
    const ownerPhone = document.getElementById('employerPhone')?.value.trim() || '';
    if (!inviteCode && !ownerPhone) {
        showToastMessage('초대 코드 또는 사장님 전화번호를 입력해 주세요.');
        return;
    }
    const settings = getUserSettings();
    settings.employerLink = {
        id: generateLocalId('employer'),
        status: 'linked',
        ownerName: settings.bizName || '연동된 운송사',
        ownerPhone,
        inviteCode,
        linkedAt: new Date().toISOString()
    };
    setUserSettings(settings);
    renderEmployedDriverLinkState();
    showToastMessage('소속 사장님과 연결했습니다.');
}

function disconnectEmployedDriver() {
    showConfirmModal('소속 연동을 해제하시겠습니까? 작성한 운행 기록은 삭제되지 않습니다.', () => {
        const settings = getUserSettings();
        settings.employerLink = null;
        setUserSettings(settings);
        document.getElementById('employerInviteCode').value = '';
        document.getElementById('employerPhone').value = '';
        renderEmployedDriverLinkState();
        showToastMessage('소속 연동을 해제했습니다.');
    });
}

function showSubCarSettings(carNum) {
    previousPage = 'main'; 
    hideAllPages();
    loadSettings(); 
    document.getElementById('subCarSettingsPage').classList.remove('hidden');
    document.getElementById('subCarSettingsTitle').innerText = `${getShortCarNum(carNum)} 기사차량 운행 일지 설정`;
}

function switchCarLog(carNum) {
    activeLogId = carNum;
    const bannerImg = document.getElementById('mainBannerImage');
    const bannerTxt = document.getElementById('mainBannerText');

    if (carNum === 'main') {
        if(bannerImg) bannerImg.style.display = 'inline-block';
        if(bannerTxt) bannerTxt.innerText = '운행 일지';
        if(bannerTxt) bannerTxt.classList.remove('sub-banner-text');
        workData = JSON.parse(localStorage.getItem('workData')) || {};
    } else {
        if(bannerImg) bannerImg.style.display = 'none';
        if(bannerTxt) bannerTxt.innerText = `${getShortCarNum(carNum)} 운행 일지`;
        if(bannerTxt) bannerTxt.classList.add('sub-banner-text');
        workData = JSON.parse(localStorage.getItem('workData_' + carNum)) || {};
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

function saveDataToStorage() {
    if (activeLogId === 'main') {
        localStorage.setItem('workData', JSON.stringify(workData));
        const settings = getUserSettings();
        const employerLink = settings.accountType === 'employed_driver' && settings.employerLink?.status === 'linked'
            ? settings.employerLink
            : null;
        const connectionKey = employerLink
            ? (employerLink.inviteCode || String(employerLink.ownerPhone || '').replace(/\D/g, ''))
            : '';
        if (connectionKey) localStorage.setItem(`linkedDriverWorkData_${connectionKey}`, JSON.stringify(workData));
    } else {
        localStorage.setItem('workData_' + activeLogId, JSON.stringify(workData));
    }
}

function normalizeLegacyData() {
    let dataChanged = false;

    for (let key in workData) {
        if (workData[key] === 'off') {
            workData[key] = {
                isOff: true,
                fixedCount: 0,
                palletCount: 0,
                callFares: [],
                maintItems: [],
                fuelItems: [],
                callDetails: [],
                startOdometer: '',
                endOdometer: '',
                dailyDistance: 0
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

        if (!workData[key].hasOwnProperty('startOdometer')) {
            workData[key].startOdometer = '';
            dataChanged = true;
        }

        if (!workData[key].hasOwnProperty('endOdometer')) {
            workData[key].endOdometer = '';
            dataChanged = true;
        }

        if (!workData[key].hasOwnProperty('dailyDistance')) {
            workData[key].dailyDistance = 0;
            dataChanged = true;
        }
    }

    if (dataChanged) {
        saveDataToStorage();
    }
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

function setActiveNav(pageId) {
    document.querySelectorAll('.bottom-nav-bar .nav-item').forEach(item => item.classList.remove('active'));
    const navItems = document.querySelectorAll('.bottom-nav-bar .nav-item');
    if (navItems.length >= 3) {
        if (pageId === 'main') {
            navItems[0].classList.add('active');
        } else if (pageId === 'workModal') {
            navItems[1].classList.add('active');
        } else if (pageId === 'settings') {
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

    const notificationBtn = document.getElementById('notificationBtn');
    if (notificationBtn) notificationBtn.style.display = 'flex';
    
    const backBtn = document.getElementById('subCarBackBtn');
    if (backBtn && activeLogId !== 'main') {
        backBtn.style.display = 'flex'; 
    }

    document.getElementById('menuReportBtn').style.display = 'flex';
    setActiveNav('main');
}

let utilityReturnPage = 'main';
let personalInfoReturnPage = 'myPage';

function setUtilityReturnPage(returnPage = 'main') {
    utilityReturnPage = returnPage === 'myPage' ? 'myPage' : 'main';
}

function goBackFromUtilityPage() {
    const returnPage = utilityReturnPage;
    utilityReturnPage = 'main';
    if (returnPage === 'myPage') {
        showMyPage();
    } else {
        showMain();
    }
}

function showMyPage() {
    utilityReturnPage = 'main';
    const settings = getUserSettings();
    const profileSummary = document.getElementById('myPageProfileSummary');
    const summaryParts = [settings.userName, settings.bizName].filter(Boolean);
    if (profileSummary) {
        profileSummary.textContent = summaryParts.length
            ? summaryParts.join(' · ')
            : '대표자 및 사업자 정보 관리';
    }

    hideAllPages();
    document.getElementById('myPage').classList.remove('hidden');
    setActiveNav('personal');
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
    loadSettings();
    updateAccountRoleUI();
    hideAllPages();
    document.getElementById('personalInfoPage').classList.remove('hidden');
    setActiveNav('personal');
}

function goBackFromPersonalInfo() {
    if (personalInfoReturnPage === 'tax') {
        showTaxInvoices(utilityReturnPage);
    } else if (personalInfoReturnPage === 'myPage') {
        showMyPage();
    } else {
        showMain();
    }
}

function showCustomerCenter(returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('customerCenterPage').classList.remove('hidden');
}

function openSupportTab(tabName, button) {
    document.querySelectorAll('.support-panel').forEach(panel => panel.classList.add('hidden'));
    document.querySelectorAll('.support-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`support-${tabName}`).classList.remove('hidden');
    button.classList.add('active');
}

function toggleSupportItem(item) {
    item.classList.toggle('open');
    const icon = item.querySelector('i');
    if (icon) icon.textContent = item.classList.contains('open') ? '−' : '+';
}

function submitSupportInquiry(event) {
    event.preventDefault();
    const inquiry = {
        type: document.getElementById('inquiryType').value,
        title: document.getElementById('inquiryTitle').value.trim(),
        content: document.getElementById('inquiryContent').value.trim(),
        createdAt: new Date().toISOString()
    };
    const inquiries = JSON.parse(localStorage.getItem('supportInquiries') || '[]');
    inquiries.unshift(inquiry);
    localStorage.setItem('supportInquiries', JSON.stringify(inquiries));
    event.target.reset();
    showToastMessage('문의가 접수되었습니다.');
}

function requestWithdrawal() {
    if (confirm('회원탈퇴는 모든 데이터에 영향을 줄 수 있습니다. 탈퇴 안내를 확인하시겠습니까?')) {
        showToastMessage('회원탈퇴 문의는 1:1 문의를 이용해 주세요.');
        const tab = document.querySelectorAll('.support-tab')[1];
        openSupportTab('inquiry', tab);
        document.getElementById('inquiryType').value = '문의';
        document.getElementById('inquiryTitle').value = '회원탈퇴 요청';
    }
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
        // 고정 거래처 표시 뱃지
        if (client.isPinned) {
            badges += `<span class="management-badge pinned">고정</span>`;
        }
        if (client.commEnabled) {
            const badgeText = client.commType === 'direct' ? `${client.commValue}원` : `${client.commValue}%`;
            badges += `<span class="management-badge commission">수수료 ${escapeDetailText(badgeText)}</span>`;
        }
        if (client.taxInvoiceEnabled) {
            badges += '<span class="management-badge tax-invoice">계산서</span>';
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

function toggleClientPinned() {
    const isPinned = document.getElementById('clientPinnedToggle').checked;
    const subSettings = document.getElementById('clientPinnedSubSettings');
    // 고정 거래처 하위 항목(수수료 토글) 노출 여부
    if (subSettings) {
        setSettingsGroupExpanded(subSettings, isPinned);
    }
    // 고정 거래처가 OFF가 되면 종속되어있는 수수료 적용 항목도 강제로 리셋 및 OFF 처리
    if (!isPinned) {
        document.getElementById('clientCommToggle').checked = false;
        toggleClientComm();
    }
}

function toggleClientTaxInvoice() {
    const enabled = document.getElementById('clientTaxInvoiceToggle')?.checked;
    setSettingsGroupExpanded(document.getElementById('clientTaxInvoiceSubSettings'), !!enabled);
}

function toggleClientComm() {
    const isChecked = document.getElementById('clientCommToggle').checked;
    setSettingsGroupExpanded(document.getElementById('clientCommSection'), isChecked);
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
    const commLabel = document.getElementById('commLabel');
    const commInput = document.getElementById('clientCommValue');

    if (!btnPercent || !btnDirect || !commLabel || !commInput) return;

    if (type === 'percent') {
        btnPercent.classList.add('active-work');
        btnDirect.classList.remove('active-work');
        commLabel.textContent = '수수료율 (%)';
        commInput.placeholder = '비율(%) 입력';
        let val = commInput.value.replace(/[^0-9.]/g, '');
        if (parseFloat(val) > 100) val = '100';
        commInput.value = val;
    } else {
        btnDirect.classList.add('active-work');
        btnPercent.classList.remove('active-work');
        commLabel.textContent = '수수료 (원)';
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

function openClientModal(index = -1) {
    editingClientIndex = index;
    const settings = getUserSettings();
    const clients = settings.clients || [];

    if (index >= 0 && clients[index]) {
        document.getElementById('clientModalTitle').textContent = '거래처 수정';
        document.getElementById('clientCompanyName').value = clients[index].companyName || '';
        document.getElementById('clientManagerName').value = clients[index].managerName || '';
        document.getElementById('clientBizNumber').value = clients[index].bizNumber || '';
        document.getElementById('clientPhone').value = clients[index].phone || '';
        
        // 고정 거래처 세팅
        document.getElementById('clientPinnedToggle').checked = !!clients[index].isPinned;
        toggleClientPinned();

        document.getElementById('clientCommToggle').checked = !!clients[index].commEnabled;
        
        const commType = clients[index].commType || 'percent';
        setClientCommType(commType);
        
        const commInput = document.getElementById('clientCommValue');
        commInput.value = clients[index].commValue || '';
        
        if (commType === 'direct') {
            formatCurrencyInput(commInput);
        } else {
            let val = commInput.value.replace(/[^0-9.]/g, '');
            if (parseFloat(val) > 100) val = '100';
            commInput.value = val;
        }
        toggleClientComm();
    } else {
        document.getElementById('clientModalTitle').textContent = '거래처 등록';
        document.getElementById('clientCompanyName').value = '';
        document.getElementById('clientManagerName').value = '';
        document.getElementById('clientBizNumber').value = '';
        document.getElementById('clientPhone').value = '';
        
        // 고정 거래처 세팅 초기화
        document.getElementById('clientPinnedToggle').checked = false;
        toggleClientPinned();

        document.getElementById('clientCommToggle').checked = false;
        setClientCommType('percent');
        document.getElementById('clientCommValue').value = '';
        toggleClientComm();
    }
    
    document.getElementById('clientModal').classList.remove('hidden');
}

function closeClientModal() {
    document.getElementById('clientModal').classList.add('hidden');
}

function cancelClientModal() {
    clientModalOpenedFromCallDetail = false;
    closeClientModal();
}

function saveClient() {
    const companyName = document.getElementById('clientCompanyName').value.trim();
    const managerName = document.getElementById('clientManagerName').value.trim();
    const bizNumber = document.getElementById('clientBizNumber').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();

    // 고정 거래처 값 및 수수료 토글의 종속 로직 처리
    const isPinned = document.getElementById('clientPinnedToggle').checked;
    const commEnabled = isPinned ? document.getElementById('clientCommToggle').checked : false; // 고정 거래처가 켜져 있을 때만 수수료 값 인정
    const commTypeEl = document.getElementById('clientCommType');
    const commType = commTypeEl ? commTypeEl.value : 'percent';
    const commValue = document.getElementById('clientCommValue').value.trim();

    if (!companyName) {
        showConfirmModal('거래처명을 입력해주세요.', null);
        return;
    }
    if (commEnabled && !commValue) {
        showConfirmModal('수수료 수치/금액을 입력해주세요.', null);
        return;
    }

    const settings = getUserSettings();
    if (!settings.clients) settings.clients = [];

    const clientData = { companyName, managerName, bizNumber, phone, isPinned, commEnabled, commType, commValue };

    if (editingClientIndex >= 0) {
        settings.clients[editingClientIndex] = clientData;
        showToastMessage('수정되었습니다.');
    } else {
        settings.clients.push(clientData);
        showToastMessage('등록되었습니다.');
    }

    setUserSettings(settings);
    closeClientModal();
    renderClientList(); // 이곳에서 자동 재정렬 됨
    buildCalendar(); 
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
        confirmModal: closeConfirmModal,
        mixedLoadModal: closeMixedLoadModal
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
            settings.clients.splice(idx, 1);
            setUserSettings(settings);
            showToastMessage('삭제되었습니다.');
            renderClientList();
            buildCalendar(); 
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

function getRecentLocations(type) {
    const field = type === 'load' ? 'loadLoc' : 'unloadLoc';
    const recent = [];
    const addLocation = value => {
        const location = String(value || '').trim();
        if (location && !recent.includes(location)) recent.push(location);
    };

    [...currentTempCallDetails].reverse().forEach(item => addLocation(item[field]));
    Object.keys(workData).sort().reverse().forEach(dateKey => {
        const details = workData[dateKey]?.callDetails || [];
        [...details].reverse().forEach(item => addLocation(item[field]));
    });
    return recent;
}

function renderLocationShortcuts() {
    renderLocationShortcutGroup('load');
    renderLocationShortcutGroup('unload');
}

function renderLocationShortcutGroup(type) {
    const settings = getUserSettings();
    const settingKey = type === 'load' ? 'pinnedLoadLocations' : 'pinnedUnloadLocations';
    const containerId = type === 'load' ? 'callLoadLocShortcuts' : 'callUnloadLocShortcuts';
    const pinned = Array.isArray(settings[settingKey]) ? settings[settingKey].filter(Boolean) : [];
    const locations = [...pinned, ...getRecentLocations(type).filter(location => !pinned.includes(location))].slice(0, 5);
    const container = document.getElementById(containerId);
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
        selectButton.addEventListener('click', () => selectLocationShortcut(type, location));

        const pinButton = document.createElement('button');
        pinButton.type = 'button';
        pinButton.className = 'location-chip-pin';
        pinButton.textContent = pinned.includes(location) ? '★' : '☆';
        pinButton.title = pinned.includes(location) ? '고정 해제' : '장소 고정';
        pinButton.setAttribute('aria-label', `${location} ${pinButton.title}`);
        pinButton.addEventListener('click', () => togglePinnedLocation(type, location));

        chip.append(selectButton, pinButton);
        container.appendChild(chip);
    });
}

function selectLocationShortcut(type, location) {
    const input = document.getElementById(type === 'load' ? 'callLoadLoc' : 'callUnloadLoc');
    if (input) input.value = location;
}

function togglePinnedLocation(type, location) {
    const settings = getUserSettings();
    const settingKey = type === 'load' ? 'pinnedLoadLocations' : 'pinnedUnloadLocations';
    const pinned = Array.isArray(settings[settingKey]) ? [...settings[settingKey]] : [];
    const index = pinned.indexOf(location);

    if (index >= 0) {
        pinned.splice(index, 1);
    } else {
        if (pinned.length >= 5) {
            showToastMessage('고정 장소는 최대 5개까지 등록할 수 있습니다.');
            return;
        }
        pinned.push(location);
    }

    settings[settingKey] = pinned;
    setUserSettings(settings);
    renderLocationShortcutGroup(type);
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

    const container = document.getElementById('carListContainer');
    container.innerHTML = '';

    if (settings.cars.length === 0) {
        container.innerHTML = '<div class="empty-state">등록된 차량이 없습니다.</div>';
    } else {
        settings.cars.forEach((car, idx) => {
            const typeBadge = car.type === 'main' 
                ? '<span class="management-badge car-type main">메인</span>' 
                : '<span class="management-badge car-type sub">기사차량</span>';
            
            const driverInfo = car.type === 'sub' && car.personalInfo && car.personalInfo.driverName ? ` [기사: ${car.personalInfo.driverName}]` : '';

            const div = document.createElement('div');
            div.className = 'car-card management-list-card car-list-card';
            div.innerHTML = `
                <div class="management-card-copy">
                    <div class="car-info-text">${typeBadge}${escapeDetailText(car.number)}${escapeDetailText(driverInfo)}${car.type === 'sub' && car.logEnabled ? '<span class="management-badge log-enabled">운행일지</span>' : ''}</div>
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
        let hasMain = cars.some((c, idx) => idx !== editingCarIndex && c.type === 'main');
        if (hasMain && editingCarIndex < 0) {
            showConfirmModal('메인 차량이 이미 등록되어 있습니다.', null);
            return;
        }
        document.getElementById('carModalTitle').textContent = '차량 등록';
        document.getElementById('logToggleContainer').style.display = 'none';
    } else {
        let subCount = cars.filter((c, idx) => idx !== editingCarIndex && c.type === 'sub').length;
        if (subCount >= 3 && editingCarIndex < 0) {
            showConfirmModal('기사 차량은 최대 3대까지 등록 가능합니다.', null);
            return;
        }
        document.getElementById('carModalTitle').textContent = '기사 등록';
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
    if (hiddenType) hiddenType.value = type;

    const btnPercent = document.getElementById('btnCarCommPercent');
    const btnDirect = document.getElementById('btnCarCommDirect');
    const label = document.getElementById('carCommLabel');
    const input = document.getElementById('newCarCommission');

    if (!btnPercent || !btnDirect || !label || !input) return;

    if (type === 'percent') {
        btnPercent.classList.add('active-work');
        btnDirect.classList.remove('active-work');
        label.textContent = '수수료율 (%)';
        input.placeholder = '비율(%) 입력';
        let val = input.value.replace(/[^0-9.]/g, '');
        if (parseFloat(val) > 100) val = '100';
        input.value = val;
    } else {
        btnDirect.classList.add('active-work');
        btnPercent.classList.remove('active-work');
        label.textContent = '수수료 (원)';
        input.placeholder = '금액(원) 입력';
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

function saveNewCar() {
    const num = document.getElementById('newCarNumber').value.trim();
    const ton = document.getElementById('newCarTonnage').value.trim();
    const mode = document.getElementById('carModalMode').value;
    
    if (!num) {
        showConfirmModal('차량번호를 입력하세요.', null);
        return;
    }

    const carType = mode === 'main' ? 'main' : 'sub';
    const settings = getUserSettings();
    if (!settings.cars) settings.cars = [];

    const logEnabled = carType === 'main' ? true : document.getElementById('newLogToggle').checked;
    const insuranceOn = carType === 'sub' ? document.getElementById('newCarInsuranceToggle').checked : false;
    
    const commEnabled = document.getElementById('newCarCommToggle') ? document.getElementById('newCarCommToggle').checked : false;
    const commType = document.getElementById('newCarCommType').value;
    const commission = commEnabled ? document.getElementById('newCarCommission').value.trim() : '';
    
    let infoType = 'existing';
    let personalInfo = null;

    if (carType === 'sub' && logEnabled) {
        const isNewInfo = document.getElementById('btnUseNewInfo').classList.contains('active-work');
        if (isNewInfo) {
            infoType = 'new';
            personalInfo = {
                driverName: document.getElementById('newDriverName').value.trim(),
                name: document.getElementById('newUserName').value.trim(),
                bizNumber: document.getElementById('newBizNumber').value.trim(),
                phone: document.getElementById('newUserPhone').value.trim(),
                bank: document.getElementById('newBankName').value.trim(),
                account: document.getElementById('newAccountNumber').value.trim()
            };
        }
    }

    const carData = { 
        number: num, 
        tonnage: ton, 
        type: carType,
        logEnabled: logEnabled,
        insuranceOn: insuranceOn,
        commType: commType,
        commission: commission,
        commEnabled: commEnabled,
        infoType: infoType,
        personalInfo: personalInfo
    };

    if (editingCarIndex > -1) {
        settings.cars[editingCarIndex] = carData; 
        showToastMessage('수정되었습니다.');
    } else {
        settings.cars.push(carData); 
        showToastMessage('등록되었습니다.');
    }
    
    setUserSettings(settings);
    
    closeCarModal(); 
    loadCarList();
    renderSubCarMenu();
    updateTransportSettingsUI(); 
}

function deleteCar(idx) {
    showConfirmModal('해당 차량을 삭제하시겠습니까?', () => {
        const settings = getUserSettings();
        const deletedCarNum = settings.cars[idx].number;
        settings.cars.splice(idx, 1);
        setUserSettings(settings);
        
        if (editingCarIndex === idx) resetCarForm();
        loadCarList();
        renderSubCarMenu(); 
        updateTransportSettingsUI(); 
        
        if(activeLogId === deletedCarNum) {
            switchCarLog('main');
        }
    });
}

function showMaintManagement() {
    showMaintFuelManagement('maint');
}

function showFuelManagement() {
    showMaintFuelManagement('fuel');
}

function showMaintFuelManagement(tab = 'maint', returnPage = 'main') {
    setUtilityReturnPage(returnPage);
    hideAllPages();
    document.getElementById('maintManagementPage').classList.remove('hidden');

    maintViewDate = new Date(viewDate.getTime());
    fuelViewDate = new Date(viewDate.getTime());

    updateMaintDateSelects();
    updateFuelDateSelects();
    selectMaintFuelTab(tab);
}

function selectMaintFuelTab(tab) {
    const maintTabBtn = document.getElementById('maintTabBtn');
    const fuelTabBtn = document.getElementById('fuelTabBtn');
    const maintTabPanel = document.getElementById('maintTabPanel');
    const fuelTabPanel = document.getElementById('fuelTabPanel');

    const isMaintTab = tab === 'maint';

    maintTabBtn.classList.toggle('active-work', isMaintTab);
    fuelTabBtn.classList.toggle('active-work', !isMaintTab);

    maintTabPanel.style.display = isMaintTab ? 'block' : 'none';
    fuelTabPanel.style.display = isMaintTab ? 'none' : 'block';

    if (isMaintTab) {
        updateMaintDateSelects();
        renderMaintList();
    } else {
        updateFuelDateSelects();
        renderFuelList();
    }
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
    document.querySelectorAll('#maintCategoryGroup .pill-btn').forEach(btn => btn.classList.remove('active'));
    if (btnEl && !isAlreadySelected) btnEl.classList.add('active');
    document.getElementById('maintRecordCategory').value = isAlreadySelected ? '' : value;
}

function selectMaintPayment(btnEl, value) {
    document.querySelectorAll('#maintPaymentGroup .segment-btn').forEach(btn => btn.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    document.getElementById('maintRecordPayment').value = value;
}

function renderMaintListLegacy() {
    const y = maintViewDate.getFullYear();
    const m = String(maintViewDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${y}-${m}-`;
    
    let groupedMaint = {};
    for (let key in workData) {
        if (key.startsWith(prefix) && workData[key].maintItems && workData[key].maintItems.length > 0) {
            groupedMaint[key] = workData[key].maintItems.map((item, index) => {
                return { name: item.name, fare: item.fare, index: index };
            });
        }
    }
    
    const sortedDates = Object.keys(groupedMaint).sort((a, b) => a.localeCompare(b));
    const container = document.getElementById('maintListContainer');
    container.innerHTML = '';
    
    if (sortedDates.length === 0) {
        container.innerHTML = '<div class="empty-state">이번 달 등록된 정비 내역이 없습니다.</div>';
        return;
    }

    sortedDates.forEach(date => {
        const items = groupedMaint[date];
        
        let itemsHtml = items.map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
                <span style="font-weight: 600;">${item.name || '정비 항목'}</span>
                <div style="display:flex; align-items:center; gap: 10px;">
                    <strong style="color:var(--sunday-color);">${parseCurrencyValue(item.fare).toLocaleString()} 원</strong>
                    <div style="display:flex; gap: 2px;">
                        <button type="button" class="action-icon-btn" onclick="openMaintRecordModal('${date}', ${item.index})" title="수정">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button type="button" class="action-icon-btn del" onclick="deleteMaintRecord('${date}', ${item.index})" title="삭제">
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        const div = document.createElement('div');
        div.className = 'setting-section';
        div.style.marginBottom = '10px';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <strong style="color:var(--primary-color); font-size:1.1rem;">${date}</strong>
            </div>
            ${itemsHtml}
        `;
        container.appendChild(div);
    });
}

function openMaintRecordModal(date = null, index = null) {
    let item = null;
    const isFromWorkModal = !document.getElementById('workModal').classList.contains('hidden');
    const maintModal = document.getElementById('maintRecordModal');

    if (!isFromWorkModal) restoreMaintFuelModalToRoot(maintModal);

    if (isFromWorkModal && index === null && maintModal.classList.contains('inline-expanded') && !maintModal.classList.contains('hidden')) {
        closeMaintFuelInlinePanel(maintModal);
        return;
    }

    if (date !== null && index !== null) {
        if (isFromWorkModal && date === selectedDateKey && currentTempMaintItems[index]) {
            item = currentTempMaintItems[index];
        } else if (workData[date] && workData[date].maintItems[index]) {
            item = workData[date].maintItems[index];
        }
    }

    if (item !== null) {
        document.getElementById('maintRecordModalTitle').textContent = '정비 내역 수정';
        document.getElementById('maintRecordDate').value = date;
        document.getElementById('maintRecordName').value = item.name;
        document.getElementById('maintRecordFare').value = parseCurrencyValue(item.fare).toLocaleString();
        
        document.getElementById('maintRecordMileage').value = item.mileage || '';
        
        const category = item.category || '';
        document.getElementById('maintRecordCategory').value = category;
        document.querySelectorAll('#maintCategoryGroup .pill-btn').forEach(btn => {
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
        document.getElementById('maintRecordModalTitle').textContent = '정비 내역 추가';
        const y = maintViewDate.getFullYear();
        const m = String(maintViewDate.getMonth() + 1).padStart(2, '0');
        const d = String(new Date().getDate()).padStart(2, '0');
        
        const currentMonth = new Date().getMonth();
        const selectedMonth = maintViewDate.getMonth();
        document.getElementById('maintRecordDate').value = (currentMonth === selectedMonth) ? `${y}-${m}-${d}` : `${y}-${m}-01`;
        
        if (isFromWorkModal && selectedDateKey) {
            document.getElementById('maintRecordDate').value = selectedDateKey;
        }

        document.getElementById('maintRecordName').value = '';
        document.getElementById('maintRecordFare').value = '';
        
        document.getElementById('maintRecordMileage').value = '';
        document.getElementById('maintRecordCategory').value = '';
        document.querySelectorAll('#maintCategoryGroup .pill-btn').forEach(btn => btn.classList.remove('active'));
        
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

function closeMaintRecordModal() {
    closeMaintFuelInlinePanel(document.getElementById('maintRecordModal'));
}

function saveMaintRecord() {
    const date = document.getElementById('maintRecordDate').value; 
    const name = document.getElementById('maintRecordName').value.trim();
    const fare = document.getElementById('maintRecordFare').value.trim();
    
    const mileage = document.getElementById('maintRecordMileage').value.trim();
    const category = document.getElementById('maintRecordCategory').value;
    const payment = document.getElementById('maintRecordPayment').value;

    const origDate = document.getElementById('maintRecordOriginalDate').value;
    const origIndex = document.getElementById('maintRecordOriginalIndex').value;

    if (!date) {
        showConfirmModal('날짜를 선택하세요.', null);
        return;
    }
    if (!name && !fare) {
        showConfirmModal('정비 항목명 또는 비용을 입력하세요.', null);
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
        if (origIndex !== '') {
            currentTempMaintItems[origIndex] = newItem;
        } else {
            currentTempMaintItems.push(newItem);
        }
        renderMaintSummaryInMainModal();
        autoSaveWorkRecord();
    } else {
        if (origDate && origIndex !== '') {
            workData[origDate].maintItems.splice(parseInt(origIndex, 10), 1);
        }

        if (!workData[date]) {
            workData[date] = { isOff: false, fixedCount: 0, palletCount: 0, callFares: [], maintItems: [], callDetails: [] };
        }
        if (!workData[date].maintItems) {
            workData[date].maintItems = [];
        }

        workData[date].maintItems.push(newItem);
        
        saveDataToStorage();
        
        const updatedDate = new Date(date);
        maintViewDate.setFullYear(updatedDate.getFullYear());
        maintViewDate.setMonth(updatedDate.getMonth());
        updateMaintDateSelects();
        renderMaintList();
        buildCalendar(); 
    }
    
    closeMaintRecordModal();
    showToastMessage('저장되었습니다.');
}

function deleteMaintRecord(date, index) {
    showConfirmModal('삭제하시겠습니까?', () => {
        workData[date].maintItems.splice(index, 1);
        saveDataToStorage(); 
        renderMaintList();
        showToastMessage('삭제되었습니다.');
        buildCalendar();
    });
}

// ========== 주유 내역 관련 로직 ==========
function renderFuelListLegacy() {
    const y = fuelViewDate.getFullYear();
    const m = String(fuelViewDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${y}-${m}-`;
    
    let groupedFuel = {};
    for (let key in workData) {
        if (key.startsWith(prefix) && workData[key].fuelItems && workData[key].fuelItems.length > 0) {
            groupedFuel[key] = workData[key].fuelItems.map((item, index) => {
                return { type: item.type, cost: item.cost, liter: item.liter, index: index };
            });
        }
    }
    
    const sortedDates = Object.keys(groupedFuel).sort((a, b) => a.localeCompare(b));
    const container = document.getElementById('fuelListContainer');
    container.innerHTML = '';
    
    if (sortedDates.length === 0) {
        container.innerHTML = '<div class="empty-state">이번 달 등록된 주유 내역이 없습니다.</div>';
        return;
    }

    sortedDates.forEach(date => {
        const items = groupedFuel[date];
        
        let itemsHtml = items.map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
                <span style="font-weight: 600;">${item.type || '주유'} ${item.liter ? `(${item.liter}L)` : ''}</span>
                <div style="display:flex; align-items:center; gap: 10px;">
                    <strong style="color:var(--primary-color);">${parseCurrencyValue(item.cost).toLocaleString()} 원</strong>
                    <div style="display:flex; gap: 2px;">
                        <button type="button" class="action-icon-btn" onclick="openFuelDetailModal('${date}', ${item.index})" title="수정">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button type="button" class="action-icon-btn del" onclick="deleteFuelRecord('${date}', ${item.index})" title="삭제">
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        const div = document.createElement('div');
        div.className = 'setting-section';
        div.style.marginBottom = '10px';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <strong style="color:var(--primary-color); font-size:1.1rem;">${date}</strong>
            </div>
            ${itemsHtml}
        `;
        container.appendChild(div);
    });
}

function renderMaintList() {
    renderMaintFuelManagementList('maint');
}

function renderFuelList() {
    renderMaintFuelManagementList('fuel');
}

function renderMaintFuelManagementList(kind) {
    const isMaint = kind === 'maint';
    const targetDate = isMaint ? maintViewDate : fuelViewDate;
    const year = targetDate.getFullYear();
    const monthNumber = targetDate.getMonth() + 1;
    const month = String(monthNumber).padStart(2, '0');
    const prefix = `${year}-${month}-`;
    const container = document.getElementById(isMaint ? 'maintListContainer' : 'fuelListContainer');
    const grouped = [];
    let monthlyTotal = 0;

    Object.keys(workData).filter(date => date.startsWith(prefix)).sort().forEach(date => {
        const source = isMaint ? workData[date].maintItems : workData[date].fuelItems;
        if (!source?.length) return;
        const items = source.map((item, index) => ({ ...item, index }));
        const dailyTotal = items.reduce((sum, item) => sum + parseCurrencyValue(isMaint ? item.fare : item.cost), 0);
        monthlyTotal += dailyTotal;
        grouped.push({ date, items, dailyTotal });
    });

    if (grouped.length === 0) {
        container.innerHTML = `<div class="empty-state">이번 달 등록된 ${isMaint ? '정비' : '주유'} 내역이 없습니다.</div>`;
    } else {
        container.innerHTML = grouped.map(group => {
            const itemHtml = group.items.map(item => {
                const amount = parseCurrencyValue(isMaint ? item.fare : item.cost);
                const title = isMaint
                    ? escapeDetailText(item.name || '정비')
                    : `${escapeDetailText(item.type || '주유')}${item.liter ? ` (${escapeDetailText(item.liter)}L)` : ''}`;
                const noteParts = isMaint
                    ? [item.payment || '카드', item.category, item.mileage ? `누적 ${item.mileage}km` : '']
                    : [item.mileage ? `누적 ${item.mileage}km` : '', item.subsidy ? `보조금 ${parseCurrencyValue(item.subsidy).toLocaleString()}원` : ''];
                const notes = noteParts.filter(Boolean).map(value => `<span>${escapeDetailText(value)}</span>`).join('');
                const icon = isMaint
                    ? '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>'
                    : fuelIconSvg();
                const editAction = isMaint ? `openMaintRecordModal('${group.date}', ${item.index})` : `openFuelDetailModal('${group.date}', ${item.index})`;
                const deleteAction = isMaint ? `deleteMaintRecord('${group.date}', ${item.index})` : `deleteFuelRecord('${group.date}', ${item.index})`;
                return `<div class="management-record-item ${isMaint ? 'maint-record' : 'fuel-record'}">
                    <div class="management-record-head"><div class="management-record-title">${icon}<strong>${title}</strong></div><div class="management-record-actions"><button type="button" class="action-icon-btn" onclick="${editAction}" title="수정">${editDetailSvg()}</button><button type="button" class="action-icon-btn del" onclick="${deleteAction}" title="삭제">${deleteDetailSvg()}</button></div></div>
                    <div class="management-record-info"><div>${notes}</div><strong>${amount.toLocaleString()}원</strong></div>
                </div>`;
            }).join('');
            return `<section class="management-day-card ${isMaint ? 'maint-day' : 'fuel-day'}">
                <div class="management-day-head"><strong>${group.date}</strong><div><span>${isMaint ? '정비' : '주유'} 합계</span><b>${group.dailyTotal.toLocaleString()}원</b></div></div>
                <div class="management-day-items">${itemHtml}</div>
            </section>`;
        }).join('');
    }

    const label = document.getElementById('maintFuelMonthLabel');
    const total = document.getElementById('maintFuelMonthTotal');
    if (label) {
        label.textContent = `${monthNumber}월 ${isMaint ? '정비' : '주유'}`;
        label.classList.toggle('fuel-color', !isMaint);
    }
    if (total) total.textContent = `${monthlyTotal.toLocaleString()}원`;
}

function openMaintFuelCurrentAdd() {
    const isMaint = document.getElementById('maintTabPanel').style.display !== 'none';
    if (isMaint) openMaintRecordModal();
    else openFuelDetailModal();
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
        showConfirmModal('날짜를 입력하세요.', null);
        return;
    }
    if (!cost && !liter) {
        showConfirmModal('비용 또는 주유량을 입력하세요.', null);
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
            workData[date] = { isOff: false, fixedCount: 0, palletCount: 0, callFares: [], maintItems: [], fuelItems: [], callDetails: [] };
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

function renderMaintSummaryInMainModalLegacy() {
    const container = document.getElementById('maintSummaryContainer');
    const listCard = document.getElementById('maintSummaryList');

    if (currentTempMaintItems.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
    } else {
        container.style.display = 'block';
        let html = '';
        let total = 0;
        currentTempMaintItems.forEach((item, idx) => {
            const fareVal = parseCurrencyValue(item.fare);
            total += fareVal;
            
            let subInfo = [];
            if(item.category) subInfo.push(item.category);
            if(item.mileage) subInfo.push(`누적 ${item.mileage}km`);
            let subInfoHtml = subInfo.length > 0 ? `<div style="font-size: 0.8rem; color: var(--sub-text-color); margin-top: 4px;">${subInfo.join(' | ')}</div>` : '';

            html += `
                <div class="maint-summary-item" style="align-items: flex-start; padding: 8px 12px; margin-bottom: 6px; border-radius:12px; background-color: var(--card-bg); border: 1px solid var(--border-color); flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-start;">
                        <div>
                            <div style="display:flex; align-items:center; gap:6px; font-weight: 700;">
                                <svg class="inline-icon sm" viewBox="0 0 24 24" style="stroke: var(--sunday-color);"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                                ${item.name || '정비 항목'}
                            </div>
                            ${subInfoHtml}
                        </div>
                        <div style="display:flex; gap: 2px; flex-shrink: 0; margin-top: -4px; margin-right: -4px;">
                            <button type="button" class="action-icon-btn" onclick="openMaintRecordModal('${selectedDateKey}', ${idx})" title="수정">
                                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button type="button" class="action-icon-btn del" onclick="currentTempMaintItems.splice(${idx}, 1); renderMaintSummaryInMainModal(); autoSaveWorkRecord();" title="삭제">
                                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                    <div style="width: 100%; display:flex; justify-content: space-between; align-items: flex-end; margin-top: 8px;">
                        <span style="font-size: 0.75rem; color: var(--sub-text-color); background: var(--input-bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">${item.payment || '카드'}</span>
                        <span style="font-weight: 700;">${fareVal.toLocaleString()}원</span>
                    </div>
                </div>
            `;
        });
        html += `
            <div class="maint-summary-item" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-color); font-weight:800; color: var(--sunday-color);">
                <span>정비 합계</span>
                <span>${total.toLocaleString()}원</span>
            </div>
        `;
        listCard.innerHTML = html;
    }
}

function renderFuelSummaryInMainModalLegacy() {
    const container = document.getElementById('fuelSummaryContainer');
    const listCard = document.getElementById('fuelSummaryList');

    if (currentTempFuelItems.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
    } else {
        container.style.display = 'block';
        let html = '';
        let total = 0;
        currentTempFuelItems.forEach((item, idx) => {
            const costVal = parseCurrencyValue(item.cost);
            total += costVal;
            
            let subInfo = [];
            if(item.mileage) subInfo.push(`누적 ${item.mileage}km`);
            let subInfoHtml = subInfo.length > 0 ? `<div style="font-size: 0.8rem; color: var(--sub-text-color); margin-top: 4px;">${subInfo.join(' | ')}</div>` : '';

            html += `
                <div class="maint-summary-item" style="align-items: flex-start; padding: 8px 12px; margin-bottom: 6px; border-radius:12px; background-color: var(--card-bg); border: 1px solid var(--border-color); flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-start;">
                        <div>
                            <div style="display:flex; align-items:center; gap:6px; font-weight: 700;">
                                ${fuelIconSvg('inline-icon sm', 'stroke: var(--primary-color);')}
                                ${item.type} ${item.liter ? `(${item.liter}L)` : ''}
                            </div>
                            ${subInfoHtml}
                        </div>
                        <div style="display:flex; gap: 2px; flex-shrink: 0; margin-top: -4px; margin-right: -4px;">
                            <button type="button" class="action-icon-btn" onclick="openFuelDetailModal('${selectedDateKey}', ${idx})" title="수정">
                                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button type="button" class="action-icon-btn del" onclick="currentTempFuelItems.splice(${idx}, 1); renderFuelSummaryInMainModal(); autoSaveWorkRecord();" title="삭제">
                                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                    <div style="width: 100%; text-align: right; font-weight: 700; margin-top: 8px;">
                        ${costVal.toLocaleString()}원
                    </div>
                </div>
            `;
        });
        html += `
            <div class="maint-summary-item" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-color); font-weight:800; color: var(--primary-color);">
                <span>주유 합계</span>
                <span>${total.toLocaleString()}원</span>
            </div>
        `;
        listCard.innerHTML = html;
    }
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

function showSettings(fromPage) {
    if (fromPage) previousPage = fromPage;
    loadSettings();
    hideAllPages();
    document.getElementById('settingsPage').classList.remove('hidden');
    setActiveNav('settings');
}

function goBackFromSettings() {
    loadSettings();
    if (previousPage === 'report') {
        showReport();
    } else {
        showMain();
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
    const callDetailOn = isMain ? savedSettings.callDetailOn : savedSettings.subCallDetailOn;

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

function togglePalletSubSettings() {
    const checked = document.getElementById('palletToggle').checked;
    setSettingsGroupExpanded(document.getElementById('palletSubSettings'), checked, 'flex');
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

function toggleSubPalletSubSettings() {
    const checked = document.getElementById('subPalletToggle').checked;
    setSettingsGroupExpanded(document.getElementById('subPalletSubSettings'), checked, 'flex');
}

function normalizeSubRunCountPresetInput() {
    setRunCountPresetChipValues('sub', getRunCountPresetChipValues('sub'));
}

function toggleSubRunCountPresetSettings() {
    const toggle = document.getElementById('subRunCountToggle');
    const setting = document.getElementById('subRunCountPresetSettings');
    setSettingsGroupExpanded(setting, !!toggle?.checked, 'flex');
}

function showToastMessage(msg = "저장되었습니다.") {
    const toast = document.getElementById('toastMessage');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 1200);
}

let smoothSettingsSaveTimer = null;
function saveSettingsSmoothly() {
    window.clearTimeout(smoothSettingsSaveTimer);
    smoothSettingsSaveTimer = window.setTimeout(() => {
        saveSettings();
    }, 430);
}

function saveSettings() {
    const settings = getUserSettings();
    
    const mainInputModeBtn = document.getElementById('btnInputModeFare');
    if (mainInputModeBtn) {
        settings.inputMode = mainInputModeBtn.classList.contains('active-work') ? 'fare' : 'count';
    }
    
    settings.fixedOn = document.getElementById('fixedToggle').checked;
    settings.unitPrice = document.getElementById('unitPrice').value;
    settings.palletOn = document.getElementById('palletToggle').checked;
    settings.palletPrice = document.getElementById('palletPrice').value;
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
        settings.subUnitPrice = document.getElementById('subUnitPrice').value;
        settings.subPalletOn = document.getElementById('subPalletToggle').checked;
        settings.subPalletPrice = document.getElementById('subPalletPrice').value;
        
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
    const settings = getUserSettings();
    settings.bizName = document.getElementById('bizName').value;
    settings.bizNumber = document.getElementById('bizNumber').value;
    settings.bizAddress = document.getElementById('bizAddress')?.value || '';
    settings.bizType = document.getElementById('bizType')?.value || '';
    settings.bizItem = document.getElementById('bizItem')?.value || '';
    settings.bizEmail = document.getElementById('bizEmail')?.value || '';
    settings.userName = document.getElementById('userName').value;
    settings.userPhone = document.getElementById('userPhone').value;
    settings.bankName = document.getElementById('bankName').value;
    settings.accountNumber = document.getElementById('accountNumber').value;
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
        document.getElementById('unitPrice').value = savedSettings.unitPrice || '';
        document.getElementById('palletToggle').checked = !!savedSettings.palletOn;
        document.getElementById('palletPrice').value = savedSettings.palletPrice || '';
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
            document.getElementById('subUnitPrice').value = savedSettings.subUnitPrice || '';
            document.getElementById('subPalletToggle').checked = !!savedSettings.subPalletOn;
            document.getElementById('subPalletPrice').value = savedSettings.subPalletPrice || '';

            document.getElementById('subCallDetailToggle').checked = savedSettings.hasOwnProperty('subCallDetailOn') ? !!savedSettings.subCallDetailOn : true;
            if(document.getElementById('subPaymentToggle')) document.getElementById('subPaymentToggle').checked = !!savedSettings.subPaymentOn;
            if(document.getElementById('subTimeToggle')) document.getElementById('subTimeToggle').checked = !!savedSettings.subTimeOn;
            if(document.getElementById('subPlatformToggle')) document.getElementById('subPlatformToggle').checked = !!savedSettings.subPlatformOn;
            if(document.getElementById('subDistanceToggle')) document.getElementById('subDistanceToggle').checked = !!savedSettings.subDistanceOn;
            if(document.getElementById('subCargoTonnageToggle')) document.getElementById('subCargoTonnageToggle').checked = savedSettings.hasOwnProperty('subCargoTonnageOn') ? !!savedSettings.subCargoTonnageOn : true;
            if(document.getElementById('subRunCountToggle')) document.getElementById('subRunCountToggle').checked = !!savedSettings.subRunCountToggle;
            setRunCountPresetChipValues('sub', savedSettings.subRunCountPresets);
            
            toggleSubFixedSettings();
            toggleSubPalletSubSettings();
            toggleSubRunCountPresetSettings();
            updateToggleDependencies('sub');
        }

        if(document.getElementById('bizName')) document.getElementById('bizName').value = savedSettings.bizName || '';
        if(document.getElementById('bizNumber')) document.getElementById('bizNumber').value = savedSettings.bizNumber || '';
        if(document.getElementById('bizAddress')) document.getElementById('bizAddress').value = savedSettings.bizAddress || '';
        if(document.getElementById('bizType')) document.getElementById('bizType').value = savedSettings.bizType || '';
        if(document.getElementById('bizItem')) document.getElementById('bizItem').value = savedSettings.bizItem || '';
        if(document.getElementById('bizEmail')) document.getElementById('bizEmail').value = savedSettings.bizEmail || '';
        document.getElementById('userName').value = savedSettings.userName || '';
        document.getElementById('userPhone').value = savedSettings.userPhone || '';
        document.getElementById('bankName').value = savedSettings.bankName || '';
        document.getElementById('accountNumber').value = savedSettings.accountNumber || '';

        toggleFixedSubSettings();
        togglePalletSubSettings();
        toggleRunCountPresetSettings();
        updateToggleDependencies('main');
    }
    updateAccountRoleUI();
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
        const subCallDetailSubSettings = document.getElementById('subCallDetailSubSettings') || document.getElementById('subPaymentToggleContainer');
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

function exportData() {
    const backupData = {
        userSettings: getUserSettings(),
        workData: JSON.parse(localStorage.getItem('workData')) || {},
        subWorkData: {}, 
        theme: localStorage.getItem('theme') || 'light'
    };
    
    if (backupData.userSettings.cars) {
        backupData.userSettings.cars.forEach(car => {
            if (car.type === 'sub' && car.logEnabled) {
                backupData.subWorkData[car.number] = JSON.parse(localStorage.getItem('workData_' + car.number)) || {};
            }
        });
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    const todayStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `운송내역_백업_${todayStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported.userSettings) setUserSettings(imported.userSettings);
            if (imported.workData) {
                localStorage.setItem('workData', JSON.stringify(imported.workData));
            }
            
            if (imported.subWorkData) {
                for (let carNum in imported.subWorkData) {
                    localStorage.setItem('workData_' + carNum, JSON.stringify(imported.subWorkData[carNum]));
                }
            }

            if (activeLogId === 'main') {
                workData = imported.workData || {};
            } else {
                workData = imported.subWorkData[activeLogId] || {};
            }
            normalizeLegacyData(); 
            
            if (imported.theme) localStorage.setItem('theme', imported.theme);

            showToastMessage('복원되었습니다!');
            loadSettings();
            buildCalendar();
            renderSubCarMenu(); 
        } catch (err) {
            showConfirmModal('올바르지 않은 백업 파일입니다.', null);
        }
    };
    reader.readAsText(file);
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
    const activePalletOn = isMain ? savedSettings.palletOn : savedSettings.subPalletOn;
    
    const displayMode = isMain ? (savedSettings.inputMode || 'count') : (savedSettings.subInputMode || 'count');

    const fixedUnitPrice = parseCurrencyValue(isMain ? savedSettings.unitPrice : savedSettings.subUnitPrice);
    const palletUnitPrice = parseCurrencyValue(isMain ? savedSettings.palletPrice : savedSettings.subPalletPrice);

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
                    dayFixedFare += fAmount;
                }
                
                if (record.palletCount > 0 && activeFixedOn && activePalletOn) {
                    dayPalletFare += record.palletCount * palletUnitPrice;
                }
                
                if (record.callFares && record.callFares.length > 0) {
                    dayWorkCount += record.callFares.length;
                    const callSum = record.callFares.reduce((a, b) => a + parseCurrencyValue(b), 0);
                    dayFare += callSum;
                    dayDefaultFare += callSum;
                }

                monthTotalDistance += parseFloat(record.dailyDistance) || 0;
                
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
                        
                        // 미수금 로직 (결제 기능이 켜져있고, 수금이 아닐 때 합산)
                        if (savedSettings.paymentOn) {
                            let payStatus = detail.paymentStatus || '미수';
                            if (payStatus === '미수') {
                                hasUnpaidToday = true;
                                monthTotalUnpaid += gross;
                            }
                        }

                        let comm = 0;
                        let clientName = detail.client ? detail.client.trim() : '';
                        let isRegisteredClient = false;

                        if (clientName) {
                            const clientObj = savedSettings.clients?.find(c => c.companyName === clientName);
                            if (clientObj) {
                                isRegisteredClient = true;
                                if (clientObj.commEnabled) {
                                    if (clientObj.commType === 'percent' || !clientObj.commType) {
                                        comm = Math.floor(gross * (parseFloat(clientObj.commValue) / 100));
                                        clientCommLabels[clientName] = `${clientObj.commValue}%`;
                                    } else {
                                        comm = parseCurrencyValue(clientObj.commValue);
                                        clientCommLabels[clientName] = `${comm.toLocaleString()}원`;
                                    }
                                    monthCommByClient[clientName] = (monthCommByClient[clientName] || 0) + comm;
                                }
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
                
                if (record.maintItems && record.maintItems.length > 0) {
                    dayMaintSum = record.maintItems.reduce((a, b) => a + parseCurrencyValue(b.fare), 0);
                }
                if (record.fuelItems && record.fuelItems.length > 0) {
                    dayFuelSum = record.fuelItems.reduce((a, b) => a + parseCurrencyValue(b.cost), 0);
                }
                
                if (dayMaintSum > 0 || dayFuelSum > 0) {
                    monthTotalMaintFare += dayMaintSum;
                    monthTotalFuelFare += dayFuelSum;
                    const expBadge = document.createElement('span');
                    expBadge.classList.add('maint-badge');
                    expBadge.textContent = formatFareShort(dayMaintSum + dayFuelSum);
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
        if (currentCar && currentCar.logEnabled && currentCar.commission) {
            const commPercent = parseFloat(currentCar.commission);
            if (!isNaN(commPercent) && commPercent > 0) {
                subCarComm = Math.floor((monthTotalFare + monthTotalPalletFare - monthTotalCommission) * (commPercent / 100));
                subCarCommLabel = `${getShortCarNum(currentCar.number)} 차량 ${commPercent}%`;
            }
        }
    }

    const isDistanceOn = activeLogId === 'main' ? !!savedSettings.distanceOn : !!savedSettings.subDistanceOn;
    updateSummary(monthTotalWork, monthTotalFare, monthTotalPalletFare, monthTotalMaintFare, monthTotalFuelFare, monthTotalCommission, subCarComm, subCarCommLabel, fixedBaseFare, defaultBaseFare, monthFareByClient, monthCommByClient, clientCommLabels, monthTotalDistance, isDistanceOn);
}

function updateSummary(totalCount, fareTotal, palletTotal, maintTotal, fuelTotal = 0, commissionTotal = 0, subCarComm = 0, subCarCommLabel = '', fixedBaseFare = 0, defaultBaseFare = 0, monthFareByClient = {}, monthCommByClient = {}, clientCommLabels = {}, monthTotalDistance = 0, isDistanceOn = false) {
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
                    <span>${client} 기본 운송료</span>
                    <span class="summary-value">${monthFareByClient[client].toLocaleString()} 원</span>
                </div>
            `;
            if (monthCommByClient[client] > 0) {
                html += `
                    <div class="summary-row summary-client-commission-row">
                        <span class="summary-client-commission-label">${client} 수수료 (${clientCommLabels[client]})</span>
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
    const activePalletOn = isMain ? savedSettings.palletOn : savedSettings.subPalletOn;

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

function normalizeRunCountPresets(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
    const values = [];
    source.forEach(item => {
        const count = parseInt(item, 10);
        if (count > 0 && !values.includes(count) && values.length < 5) values.push(count);
    });
    for (let fallback = 1; values.length < 5; fallback++) {
        if (!values.includes(fallback)) values.push(fallback);
    }
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

function setRunCountPresetChipValues(scope = 'main', value) {
    const containerId = scope === 'sub' ? 'subRunCountPresetChips' : 'runCountPresetChips';
    const inputs = document.querySelectorAll(`#${containerId} .run-count-preset-chip`);
    const presets = normalizeRunCountPresets(value);
    inputs.forEach((input, index) => {
        input.value = presets[index];
    });
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

function openModal(dateKey, month, day) {
    selectedDateKey = dateKey;
    appState.selectedDateKey = dateKey; // appState 객체 동기화 추가
    document.getElementById('modalTitle').textContent = `${month}월 ${day}일 운행 일지`;

    const savedSettings = getUserSettings();
    const isMain = activeLogId === 'main';
    const fixedOn = isMain ? savedSettings.fixedOn : savedSettings.subFixedOn;
    const palletOn = isMain ? savedSettings.palletOn : savedSettings.subPalletOn;
    const callOn = isMain ? savedSettings.callOn : savedSettings.subCallOn;
    const callDetailOn = isMain ? savedSettings.callDetailOn : savedSettings.subCallDetailOn;
    
    document.getElementById('modalFixedSection').style.display = fixedOn ? 'block' : 'none';
    document.getElementById('modalPalletSection').style.display = (fixedOn && palletOn) ? 'block' : 'none';
    document.getElementById('modalCallSection').style.display = callOn ? 'block' : 'none';
    document.getElementById('modalCallDetailSection').style.display = callDetailOn ? 'block' : 'none';
    renderFixedCountQuickButtons(savedSettings, isMain);

    const record = workData[dateKey];
    const callContainer = document.getElementById('callListContainer');
    callContainer.innerHTML = '';

    currentTempMaintItems = [];
    currentTempCallDetails = [];
    currentTempFuelItems = [];

    if (record) {
        setOffState(!!record.isOff);
        document.getElementById('modalFixedCountInput').value = record.fixedCount || '';
        document.getElementById('modalPalletCount').value = record.palletCount || '';

        if (record.callFares && record.callFares.length > 0) {
            record.callFares.forEach(val => addCallInputRow(val));
        }
        if (record.maintItems && record.maintItems.length > 0) {
            currentTempMaintItems = JSON.parse(JSON.stringify(record.maintItems));
        }
        if (record.fuelItems && record.fuelItems.length > 0) {
            currentTempFuelItems = JSON.parse(JSON.stringify(record.fuelItems));
        }
        if (record.callDetails && record.callDetails.length > 0) {
            currentTempCallDetails = JSON.parse(JSON.stringify(record.callDetails));
        }
    } else {
        setOffState(false);
        document.getElementById('modalFixedCountInput').value = '';
        document.getElementById('modalPalletCount').value = '';
    }

    syncFixedCountQuickButtons();

    renderMaintSummaryInMainModal();
    renderFuelSummaryInMainModal();
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

function updateOdometerDistance(shouldSave = true) {
    const startInput = document.getElementById('modalStartOdometer');
    const endInput = document.getElementById('modalEndOdometer');
    const resultEl = document.getElementById('modalDailyDistanceResult');

    if (!startInput || !endInput || !resultEl) {
        return 0;
    }

    const startValue = parseCurrencyValue(startInput.value);
    const endValue = parseCurrencyValue(endInput.value);
    const hasStartValue = startInput.value.trim() !== '';
    const hasEndValue = endInput.value.trim() !== '';

    resultEl.classList.remove('error');

    if (!hasStartValue || !hasEndValue) {
        resultEl.textContent = '입력 대기';
        return 0;
    }

    if (endValue < startValue) {
        resultEl.textContent = '계기판 수치 확인';
        resultEl.classList.add('error');
        return 0;
    }

    const dailyDistance = endValue - startValue;
    resultEl.textContent = `${dailyDistance.toLocaleString()} km`;

    if (shouldSave && !isOffSelected) {
        autoSaveWorkRecord();
    }

    return dailyDistance;
}

function handleOdometerPhoto(input, type) {
    const file = input.files && input.files[0];

    if (!file) {
        return;
    }

    const previewId = type === 'start' ? 'startOdometerPreview' : 'endOdometerPreview';
    const preview = document.getElementById(previewId);
    const reader = new FileReader();

    reader.onload = (event) => {
        preview.src = event.target.result;
        preview.classList.remove('hidden');
        showToastMessage('계기판 사진이 선택되었습니다. AI/OCR API 연결 후 숫자가 자동 입력됩니다.');
    };

    reader.readAsDataURL(file);
}

function addCallInputRow(val = '') {
    if (isOffSelected) setOffState(false);
    const container = document.getElementById('callListContainer');
    const div = document.createElement('div');
    div.className = 'call-item-row';
    div.innerHTML = `
        <input type="text" class="input-box call-fare-input" inputmode="numeric" placeholder="운송료 입력" value="${val}" oninput="formatCurrencyInput(this); autoSaveWorkRecord();">
        <button type="button" class="btn-del" onclick="this.parentElement.remove(); autoSaveWorkRecord();">삭제</button>
    `;
    container.appendChild(div);
    autoSaveWorkRecord();
}

function renderCallDetailSummaryInMainModalLegacy() {
    const container = document.getElementById('callDetailSummaryContainer');
    const listCard = document.getElementById('callDetailSummaryList');
    const dailyDistanceEl = document.getElementById('modalDailyDistance');

    if (currentTempCallDetails.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
        if (dailyDistanceEl) dailyDistanceEl.textContent = `일일 운행거리: 0 km`;
    } else {
        container.style.display = 'block';
        const fragment = document.createDocumentFragment();
        let total = 0;
        let dailyDist = 0;
        let totalComm = 0; 
        
        const settings = getActiveLogSettings();
        
        currentTempCallDetails.forEach((item, index) => {
            const fareVal = parseCurrencyValue(item.fare);
            total += fareVal;
            dailyDist += parseFloat(item.distanceKm) || 0;
            
            // 운행 거리 뱃지
            let distBadge = '';
            if (settings.distanceOn && (item.distanceType || item.distanceKm)) {
                distBadge = `<span style="font-size:0.75rem; background:var(--input-bg); padding:2px 6px; border-radius:4px; border:1px solid var(--border-color); color:var(--text-color); margin-left:6px;">${item.distanceType || ''} ${item.distanceKm ? item.distanceKm + 'km' : ''}</span>`;
            }

            // 수수료 텍스트 및 전화번호(미수 전화용)
            let commText = '';
            let clientPhone = '';
            if (item.client) {
                const clientObj = settings.clients?.find(c => c.companyName === item.client);
                if (clientObj) {
                    if (clientObj.phone) clientPhone = clientObj.phone;
                    if (clientObj.commEnabled) {
                        const valStr = clientObj.commType === 'direct' ? parseCurrencyValue(clientObj.commValue).toLocaleString() + '원' : clientObj.commValue + '%';
                        commText = `<span style="color:var(--sunday-color); font-size:0.8rem;">(수수료 ${valStr})</span>`;
                        
                        let comm = 0;
                        if (clientObj.commType === 'direct') {
                            comm = parseCurrencyValue(clientObj.commValue);
                        } else {
                            comm = Math.floor(fareVal * (parseFloat(clientObj.commValue) / 100));
                        }
                        totalComm += comm;
                    }
                }
            }

            // 운행 시간 표시
            let timeHtml = '';
            if (settings.timeOn && (item.departureTime || item.arrivalTime)) {
                let diffText = '';
                if (item.departureTime && item.arrivalTime) {
                    const [dh, dm] = item.departureTime.split(':').map(Number);
                    const [ah, am] = item.arrivalTime.split(':').map(Number);
                    let dMin = dh * 60 + dm;
                    let aMin = ah * 60 + am;
                    if (aMin < dMin) aMin += 24 * 60; 
                    const diff = aMin - dMin;
                    const hrs = Math.floor(diff / 60);
                    const mins = diff % 60;
                    diffText = ` <span style="font-weight:700; color:var(--primary-color);">(${hrs > 0 ? hrs + '시간 ' : ''}${mins > 0 ? mins + '분' : (hrs > 0 ? '' : '0분')})</span>`;
                }
                timeHtml = `<div style="font-size: 0.85rem; color: var(--sub-text-color); margin-top: 4px;">운행시간: ${item.departureTime || '-'} ~ ${item.arrivalTime || '-'} ${diffText}</div>`;
            }

            // 플랫폼 및 계산서 뱃지
            let badgesHtml = '';
            if (settings.paymentOn && item.receipt) badgesHtml += `<span class="detail-badge">${item.receipt}</span>`;
            if (settings.platformOn && item.platform) badgesHtml += `<span class="detail-badge">${item.platform}</span>`;
            if (settings.cargoTonnageOn && item.cargoTonnage) badgesHtml += `<span class="detail-badge">${item.cargoTonnage}톤</span>`;

            // 결제 상태 (미수/수금)
            let payStatus = item.paymentStatus || '미수';
            let isUnpaid = payStatus === '미수';
            let cardClass = isUnpaid ? 'maint-summary-item unpaid-card' : 'maint-summary-item';
            let statusBtn = '';
            
            if (settings.paymentOn) {
                let phoneBtn = '';
                if (isUnpaid) {
                    if (clientPhone) {
                        phoneBtn = `<a href="tel:${clientPhone}" class="call-phone-btn" onclick="event.stopPropagation();" title="전화걸기">
                                        <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                    </a>`;
                    } else {
                        phoneBtn = `<button type="button" class="call-phone-btn" onclick="showConfirmModal('거래처에 등록된 연락처가 없습니다.', null); event.stopPropagation();" title="전화걸기(연락처 없음)">
                                        <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                    </button>`;
                    }
                }
                
                statusBtn = `<div style="display:flex; align-items:center; gap:6px;">
                                ${phoneBtn}
                                <button type="button" onclick="toggleCallPaymentStatus(${index})" class="payment-toggle-btn ${isUnpaid ? 'unpaid' : 'paid'}">${isUnpaid ? '미수' : '수금'}</button>
                             </div>`;
            } else {
                cardClass = 'maint-summary-item'; 
            }

            const itemDiv = document.createElement('div');
            itemDiv.className = cardClass;
            itemDiv.style.cssText = 'align-items: flex-start; padding:12px; margin-bottom:12px; border-radius:12px; background-color: var(--card-bg); border: 1px solid var(--border-color);';
            itemDiv.innerHTML = `
                <div style="flex:1; width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                        <div style="font-weight: 700; color: var(--primary-color); display:flex; align-items:center; gap:6px;">
                            ${item.loadLoc || '상차지 미상'} ➔ ${item.unloadLoc || '하차지 미상'} 
                            ${distBadge}
                        </div>
                        <div style="display:flex; gap: 2px; flex-shrink: 0; margin-top: -4px; margin-right: -4px;">
                            <button type="button" class="action-icon-btn" onclick="openCallDetailModal(${index})" title="수정">
                                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button type="button" class="action-icon-btn del" onclick="deleteCallDetail(${index})" title="삭제">
                                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-color);">
                            운송료: ${fareVal.toLocaleString()}원
                        </div>
                    </div>
                    
                    <div style="font-size: 0.85rem; color: var(--sub-text-color);">
                        거래처: ${item.client || '-'} ${commText}
                    </div>
                    
                    ${timeHtml}
                    
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px;">
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">${badgesHtml}</div>
                        <div>${statusBtn}</div>
                    </div>
                </div>
            `;
            fragment.appendChild(itemDiv);
        });

        listCard.innerHTML = '';
        listCard.appendChild(fragment);

        let commSummaryHtml = '';
        if (totalComm > 0) {
            commSummaryHtml = `
                <div style="display: flex; justify-content: space-between; width: 100%; font-size: 0.85rem; color: var(--sunday-color); margin-top: 6px; font-weight: 700;">
                    <span>수수료</span>
                    <span>- ${totalComm.toLocaleString()}원</span>
                </div>
            `;
        }

        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'maint-summary-item';
        summaryDiv.style.cssText = 'margin-top: 10px; padding: 10px 4px 0 4px; border-top: 1px dashed var(--border-color); font-weight:800; color: var(--primary-color); flex-direction: column;';
        summaryDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; width: 100%;">
                <span>세부 내역 합계 (${currentTempCallDetails.length}건)</span>
                <span>${total.toLocaleString()}원</span>
            </div>
            ${commSummaryHtml}
            <div style="display: flex; justify-content: space-between; width: 100%; font-size: 0.85rem; color: var(--text-color); margin-top: 6px;">
                <span>일일 운행거리</span>
                <span>${dailyDist} km</span>
            </div>
        `;
        listCard.appendChild(summaryDiv);
        
        if (dailyDistanceEl) dailyDistanceEl.style.display = 'none';
    }
}

function renderCallDetailSummaryInMainModal() {
    const container = document.getElementById('callDetailSummaryContainer');
    const listCard = document.getElementById('callDetailSummaryList');
    const dailyDistanceEl = document.getElementById('modalDailyDistance');
    if (!container || !listCard) return;

    if (currentTempCallDetails.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
        if (dailyDistanceEl) dailyDistanceEl.textContent = '일일 운행거리: 0 km';
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
    const getCommission = (item, fare) => {
        const client = getClientInfo(item.client);
        if (!client?.commEnabled) return { amount: 0, label: '' };
        const amount = client.commType === 'direct'
            ? parseCurrencyValue(client.commValue)
            : Math.floor(fare * (parseFloat(client.commValue) || 0) / 100);
        const label = client.commType === 'direct'
            ? `${parseCurrencyValue(client.commValue).toLocaleString()}원`
            : `${client.commValue}%`;
        return { amount, label };
    };

    const cardsHtml = currentTempCallDetails.map((item, index) => {
        const fare = parseCurrencyValue(item.fare);
        const commission = getCommission(item, fare);
        const vat = item.vatExempt ? 0 : Math.round(fare * 0.1);
        const insuranceFee = parseCurrencyValue(item.insuranceFee);
        const finalTotal = fare - commission.amount - insuranceFee + vat;
        const distance = parseFloat(item.distanceKm) || 0;
        const client = getClientInfo(item.client);
        const unpaid = (item.paymentStatus || '미수') === '미수';
        totalFare += fare;
        totalCommission += commission.amount;
        totalInsuranceFee += insuranceFee;
        totalVat += vat;
        totalDistance += distance;

        const phoneButton = settings.paymentOn && unpaid
            ? (client?.phone
                ? `<a href="tel:${client.phone}" class="call-phone-btn detail-call-phone" onclick="event.stopPropagation()" title="전화걸기">${callPhoneSvg()}</a>`
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
            <div><b>부가세(10%)</b><strong>${totalVat.toLocaleString()}원</strong></div>
            <div class="summary-grand-total"><b>세부 내역 합계 (${currentTempCallDetails.length}건)</b><strong>${grandTotal.toLocaleString()}원</strong></div>
        </div>`;
    if (dailyDistanceEl) dailyDistanceEl.style.display = 'none';
}

function escapeDetailText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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

function selectCallDetailBtn(groupName, value, isEditInit = false) {
    let container, hiddenInput;
    if (groupName === 'receipt') {
        container = document.getElementById('callReceiptGroup');
        hiddenInput = document.getElementById('callReceiptValue');
    } else if (groupName === 'distance') {
        container = document.getElementById('callDistanceGroup');
        hiddenInput = document.getElementById('callDistanceType');
        
        // 사용자가 직접 '혼짐'을 클릭했을 때 (초기화 단계 제외)
        if (value === '혼짐' && !isEditInit) {
            const isAlreadyActive = hiddenInput.value === value;
            if (!isAlreadyActive) {
                openMixedLoadModal(); // 3차 모달 호출
            } else {
                hiddenInput.value = '';
                container.querySelectorAll('.dark-pill-btn').forEach(btn => btn.classList.remove('active'));
                document.getElementById('callLinkedLoadIndex').value = '-1';
            }
            return;
        }
    }
    if(!container || !hiddenInput) return;

    const isAlreadyActive = hiddenInput.value === value;
    container.querySelectorAll('.dark-pill-btn').forEach(btn => btn.classList.remove('active'));
    
    if (isAlreadyActive) {
        hiddenInput.value = ''; 
        if (groupName === 'distance') document.getElementById('callLinkedLoadIndex').value = '-1';
    } else {
        hiddenInput.value = value;
        const activeBtn = Array.from(container.querySelectorAll('.dark-pill-btn')).find(btn => btn.textContent.trim() === value);
        if(activeBtn) activeBtn.classList.add('active');
        if (groupName === 'distance' && value !== '혼짐') document.getElementById('callLinkedLoadIndex').value = '-1';
    }
}

function openMixedLoadModal() {
    const container = document.getElementById('mixedLoadListContainer');
    container.innerHTML = '';
    
    const currentIndex = parseInt(document.getElementById('callDetailEditIndex').value, 10);
    
    let html = `
        <label style="display:flex; align-items:center; gap:8px; padding:10px; background:var(--hover-bg); border-radius:8px; cursor:pointer;">
            <input type="radio" name="mixedLoadTarget" value="pending" checked>
            <span style="font-weight:700;">+ 추가 예정 (새로운 혼짐 기준)</span>
        </label>
    `;
    
    currentTempCallDetails.forEach((item, idx) => {
        if (idx !== currentIndex) {
            const title = `${item.loadLoc || '상차지 미상'} ➔ ${item.unloadLoc || '하차지 미상'}`;
            html += `
                <label style="display:flex; align-items:center; gap:8px; padding:10px; background:var(--input-bg); border:1px solid var(--border-color); border-radius:8px; cursor:pointer;">
                    <input type="radio" name="mixedLoadTarget" value="${idx}">
                    <span style="font-weight:600; font-size:0.9rem;">${title}</span>
                </label>
            `;
        }
    });
    
    container.innerHTML = html;
    document.getElementById('mixedLoadModal').classList.remove('hidden');
}

function closeMixedLoadModal() {
    document.getElementById('mixedLoadModal').classList.add('hidden');
}

function saveMixedLoad() {
    const selected = document.querySelector('input[name="mixedLoadTarget"]:checked');
    if (selected) {
        document.getElementById('callLinkedLoadIndex').value = selected.value;
        
        const container = document.getElementById('callDistanceGroup');
        const hiddenInput = document.getElementById('callDistanceType');
        
        hiddenInput.value = '혼짐';
        container.querySelectorAll('.dark-pill-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = Array.from(container.querySelectorAll('.dark-pill-btn')).find(btn => btn.textContent.trim() === '혼짐');
        if (activeBtn) activeBtn.classList.add('active');
    }
    closeMixedLoadModal();
}

function openCallDetailModal(index = -1) {
    if (isOffSelected) setOffState(false);
    
    const settings = getActiveLogSettings();

    populateClientDataList();
    populateLocationDataLists();
    renderPinnedClientShortcuts();
    renderLocationShortcuts();

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
    if(document.getElementById('callDistanceType')) document.getElementById('callDistanceType').value = '';
    if(document.getElementById('callLinkedLoadIndex')) document.getElementById('callLinkedLoadIndex').value = '-1';
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
        
        if (item.receipt) selectCallDetailBtn('receipt', item.receipt, true);
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
    const distanceType = document.getElementById('callDistanceType') ? document.getElementById('callDistanceType').value : '';
    const distanceKm = document.getElementById('callDistanceKm') ? document.getElementById('callDistanceKm').value.trim() : '';
    const startOdometer = document.getElementById('callStartOdometer') ? document.getElementById('callStartOdometer').value.trim() : '';
    const endOdometer = document.getElementById('callEndOdometer') ? document.getElementById('callEndOdometer').value.trim() : '';
    const vatExempt = document.getElementById('callVatExemptToggle') ? document.getElementById('callVatExemptToggle').checked : false;
    const insuranceFee = document.getElementById('callInsuranceFee') ? document.getElementById('callInsuranceFee').value.trim() : '';
    const linkedLoadIndex = document.getElementById('callLinkedLoadIndex') ? document.getElementById('callLinkedLoadIndex').value : '-1';
    const platform = document.getElementById('callPlatform') ? document.getElementById('callPlatform').value.trim() : '';

    if (!fare && !loadLoc && !unloadLoc) {
        showConfirmModal('최소한 운송료나 상/하차지는 입력해야 합니다.', null);
        return;
    }

    const existingItem = idx >= 0 && currentTempCallDetails[idx] ? currentTempCallDetails[idx] : null;
    const paymentStatus = existingItem ? (existingItem.paymentStatus || '미수') : '미수';

    const newItem = {
        loadLoc,
        unloadLoc,
        fare,
        client,
        remarks,
        departureTime,
        arrivalTime,
        receipt,
        distanceType,
        distanceKm,
        startOdometer,
        endOdometer,
        vatExempt,
        insuranceFee,
        linkedLoadIndex,
        platform,
        paymentStatus,
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
    showMain();
}

function autoSaveWorkRecord() {
    if (!selectedDateKey) return;

    const savedSettings = getUserSettings();
    const isMain = activeLogId === 'main';
    const fixedOn = isMain ? savedSettings.fixedOn : savedSettings.subFixedOn;
    const palletOn = isMain ? savedSettings.palletOn : savedSettings.subPalletOn;
    const callOn = isMain ? savedSettings.callOn : savedSettings.subCallOn;

    let fixedCount = 0;
    let palletCount = 0;
    let callFares = [];

    if (!isOffSelected) {
        if (fixedOn) {
            fixedCount = parseInt(document.getElementById('modalFixedCountInput').value, 10) || 0;

            if (palletOn) {
                palletCount = parseInt(document.getElementById('modalPalletCount').value, 10) || 0;
            }
        }

        if (callOn) {
            const inputs = document.querySelectorAll('.call-fare-input');

            inputs.forEach(input => {
                if (input.value.trim() !== '') {
                    callFares.push(input.value.trim());
                }
            });
        }
    }

    const maintItems = currentTempMaintItems;
    const fuelItems = currentTempFuelItems;
    const callDetails = currentTempCallDetails;

    if (!isOffSelected && fixedCount === 0 && palletCount === 0 && callFares.length === 0 && maintItems.length === 0 && fuelItems.length === 0 && callDetails.length === 0) {
        delete workData[selectedDateKey];
    } else {
        workData[selectedDateKey] = {
            isOff: isOffSelected,
            fixedCount,
            palletCount,
            callFares,
            maintItems,
            fuelItems,
            callDetails
        };
    }

    saveDataToStorage();
    buildCalendar();
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
    
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars.find(c => c.number === activeLogId);
        if (currentCar) {
            document.getElementById('rptCarNumber').textContent = currentCar.number || '-';
            document.getElementById('rptCarTonnage').textContent = currentCar.tonnage || '-';
            
            if (currentCar.logEnabled && currentCar.infoType === 'new' && currentCar.personalInfo) {
                rptName = currentCar.personalInfo.name || rptName;
                rptPhone = currentCar.personalInfo.phone || rptPhone;
                rptBank = currentCar.personalInfo.bank || rptBank;
                rptAccount = currentCar.personalInfo.account || rptAccount;
            }
        }
    } else if (savedSettings.cars && savedSettings.cars.length > 0) {
        const mainCar = savedSettings.cars.find(c => c.type === 'main') || savedSettings.cars[0];
        
        if (mainCar.logEnabled && mainCar.infoType === 'new' && mainCar.personalInfo) {
            rptName = mainCar.personalInfo.name || rptName;
            rptPhone = mainCar.personalInfo.phone || rptPhone;
            rptBank = mainCar.personalInfo.bank || rptBank;
            rptAccount = mainCar.personalInfo.account || rptAccount;
        }

        document.getElementById('rptCarNumber').textContent = mainCar.number || '-';
        document.getElementById('rptCarTonnage').textContent = mainCar.tonnage || '-';

    } else {
        document.getElementById('rptCarNumber').textContent = '-';
        document.getElementById('rptCarTonnage').textContent = '-';
    }

    document.getElementById('rptUserName').textContent = rptName;
    document.getElementById('rptUserPhone').textContent = rptPhone;
    document.getElementById('rptBankName').textContent = rptBank;
    document.getElementById('rptAccountNumber').textContent = rptAccount;

    const isMain = activeLogId === 'main';
    const fixedUnitPrice = parseCurrencyValue(isMain ? savedSettings.unitPrice : savedSettings.subUnitPrice);
    const palletUnitPrice = parseCurrencyValue(isMain ? savedSettings.palletPrice : savedSettings.subPalletPrice);
    const showPallet = !!((isMain ? savedSettings.fixedOn : savedSettings.subFixedOn) && (isMain ? savedSettings.palletOn : savedSettings.subPalletOn));

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
                    dayDefaultFare += fAmt;
                }
                if (record.callFares && record.callFares.length > 0) {
                    dayWorkCount += record.callFares.length;
                    let cAmt = record.callFares.reduce((a, b) => a + parseCurrencyValue(b), 0);
                    dayFare += cAmt;
                    dayDefaultFare += cAmt;
                }

                totalMonthDistance += parseFloat(record.dailyDistance) || 0;

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
                                if (clientObj.commEnabled) {
                                    if (clientObj.commType === 'percent' || !clientObj.commType) {
                                        comm = Math.floor(gross * (parseFloat(clientObj.commValue) / 100));
                                        clientCommLabels[clientName] = `${clientObj.commValue}%`;
                                    } else {
                                        comm = parseCurrencyValue(clientObj.commValue);
                                        clientCommLabels[clientName] = `${comm.toLocaleString()}원`;
                                    }
                                    monthCommByClient[clientName] = (monthCommByClient[clientName] || 0) + comm;
                                }
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
        if (currentCar && currentCar.logEnabled && currentCar.commission) {
            const commPercent = parseFloat(currentCar.commission);
            if (!isNaN(commPercent) && commPercent > 0) {
                subCarComm = Math.floor((totalFare + totalPalletFare - totalCommission) * (commPercent / 100));
                subCarCommLabel = `${getShortCarNum(currentCar.number)}차량 ${commPercent}%`;
            }
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
                <span>${client} 기본 운송료</span>
                <span class="summary-value">${monthFareByClient[client].toLocaleString()} 원</span>
            </div>
        `;
        if (monthCommByClient[client] > 0) {
            baseFareHtml += `
                <div class="summary-row">
                    <span style="padding-left: 10px; font-size: 0.9rem; color: var(--sub-text-color);">└ ${client} 수수료 (${clientCommLabels[client]})</span>
                    <span class="summary-value">- ${monthCommByClient[client].toLocaleString()} 원</span>
                </div>
            `;
        }
    }
    
    summaryBox.innerHTML = `
        ${baseFareHtml}
        <div class="summary-row">
            <span>부가세 (10%)</span>
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
                        <td class="detail-text-cell detail-location-cell" style="padding: ${cellPadding};">${item.loadLoc}</td>
                        <td class="detail-text-cell detail-location-cell" style="padding: ${cellPadding};">${item.unloadLoc}</td>
                        ${showClientColumn ? `<td class="detail-text-cell" style="padding: ${cellPadding};">${item.client}</td>` : ''}
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
                            if (clientObj.commEnabled) {
                                if (clientObj.commType === 'percent' || !clientObj.commType) {
                                    comm = Math.floor(fareVal * (parseFloat(clientObj.commValue) / 100));
                                    clientCommLabels[clientName] = `${clientObj.commValue}%`;
                                } else {
                                    comm = parseCurrencyValue(clientObj.commValue);
                                    clientCommLabels[clientName] = `${comm.toLocaleString()}원`;
                                }
                                monthCommByClient[clientName] = (monthCommByClient[clientName] || 0) + comm;
                            }
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
        if (currentCar && currentCar.logEnabled && currentCar.commission) {
            const commPercent = parseFloat(currentCar.commission);
            if (!isNaN(commPercent) && commPercent > 0) {
                subCarComm = Math.floor((totalFare - totalCommission) * (commPercent / 100));
                subCarCommLabel = `${getShortCarNum(currentCar.number)}차량 ${commPercent}%`;
            }
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
                <span>${client} 기본 운송료</span>
                <span class="summary-value">${monthFareByClient[client].toLocaleString()} 원</span>
            </div>
        `;
        if (monthCommByClient[client] > 0) {
            baseFareHtml += `
                <div class="summary-row">
                    <span style="padding-left: 10px; font-size: 0.9rem; color: var(--sub-text-color);">└ ${client} 수수료 (${clientCommLabels[client]})</span>
                    <span class="summary-value">- ${monthCommByClient[client].toLocaleString()} 원</span>
                </div>
            `;
        }
    }

    summaryBox.innerHTML = `
        ${baseFareHtml}
        <div class="summary-row">
            <span>부가세 (10%)</span>
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
    const isChecked = document.getElementById('newLogToggle').checked;
    setSettingsGroupExpanded(document.getElementById('newLogSettings'), isChecked);
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
    document.getElementById('logToggleContainer').style.display = 'none';
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
    document.getElementById('newUserName').value = '';
    document.getElementById('newBizNumber').value = '';
    document.getElementById('newUserPhone').value = '';
    document.getElementById('newBankName').value = '';
    document.getElementById('newAccountNumber').value = '';
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
        document.getElementById('logToggleContainer').style.display = 'none';
    } else {
        document.getElementById('carModalTitle').textContent = '기사 정보 수정';
        document.getElementById('logToggleContainer').style.display = 'block';
    }
    
    if (car.type === 'sub') {
        document.getElementById('newCarInsuranceToggle').checked = !!car.insuranceOn;
        
        if (document.getElementById('newCarCommToggle')) {
            document.getElementById('newCarCommToggle').checked = !!car.commEnabled;
            toggleNewCarCommSettings();
        }
        setCarCommType(car.commType || 'percent');
        document.getElementById('newCarCommission').value = car.commission || '';

        if (car.logEnabled) {
            document.getElementById('newLogToggle').checked = true;
            toggleNewLogSettings();
            if (car.infoType === 'new') {
                selectInfoType('new');
                if (car.personalInfo) {
                    document.getElementById('newDriverName').value = car.personalInfo.driverName || '';
                    document.getElementById('newUserName').value = car.personalInfo.name || '';
                    document.getElementById('newBizNumber').value = car.personalInfo.bizNumber || '';
                    document.getElementById('newUserPhone').value = car.personalInfo.phone || '';
                    document.getElementById('newBankName').value = car.personalInfo.bank || '';
                    document.getElementById('newAccountNumber').value = car.personalInfo.account || '';
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
loadSettings();
initDateSelects();
initMaintDateSelects(); 
initFuelDateSelects();
initCalendarDOM();
buildCalendar();
renderSubCarMenu();
updateAccountRoleUI();

// 스플래시 화면(시작 화면) 제어 로직
window.addEventListener('load', () => {
    const splashScreen = document.getElementById('splashScreen');

    if (splashScreen) {
        setTimeout(() => {
            splashScreen.style.opacity = '0';
            splashScreen.style.transition = 'opacity 0.5s ease';

            setTimeout(() => {
                splashScreen.style.display = 'none';

                const settings = getUserSettings();
                updateOverdueNotification(true);

                if (!settings.accountType) showAccountTypePage('login');
                else if (!settings.isLoggedIn) showLocalLoginPage();
            }, 500);
        }, 1500);
    }
});

function handleLogin() {
    const settings = getUserSettings();
    if (!settings.accountType) showAccountTypePage('login');
    else showLocalLoginPage();
}

function handleLogout() {
    showConfirmModal('로그아웃하시겠습니까? 기기에 저장된 기록은 유지됩니다.', () => {
        const settings = getUserSettings();
        settings.isLoggedIn = false;
        setUserSettings(settings);
        updateAccountRoleUI();
        showLocalLoginPage();
    });
}

function toggleCallPaymentStatus(index) {
    if (index >= 0 && currentTempCallDetails[index]) {
        let currentStatus = currentTempCallDetails[index].paymentStatus || '미수';
        currentTempCallDetails[index].paymentStatus = (currentStatus === '미수') ? '수금' : '미수';
        
        // UI 즉시 업데이트
        renderCallDetailSummaryInMainModal();
        if (!document.getElementById('workModal').classList.contains('hidden')) {
            autoSaveWorkRecord();
        }
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

function getReceivableItems() {
    const items = [];

    Object.keys(workData).forEach(dateKey => {
        const record = workData[dateKey];

        if (!record || record.isOff || !record.callDetails) {
            return;
        }

        record.callDetails.forEach((detail, detailIndex) => {
            if ((detail.paymentStatus || '미수') !== '미수') {
                return;
            }

            items.push({
                dateKey,
                detailIndex,
                client: detail.client || '미지정 거래처',
                fare: parseCurrencyValue(detail.fare),
                paymentDueDate: detail.paymentDueDate || '',
                workDate: detail.workDate || dateKey,
                loadLoc: detail.loadLoc || '',
                unloadLoc: detail.unloadLoc || '',
                remarks: detail.remarks || ''
            });
        });
    });

    return items;
}

function getOverdueReceivableItems() {
    if (!getActiveLogSettings().paymentOn) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return getReceivableItems().filter(item => {
        if (!item.paymentDueDate) return false;
        const dueDate = new Date(`${item.paymentDueDate}T00:00:00`);
        return !Number.isNaN(dueDate.getTime()) && dueDate < today;
    });
}

function getNotificationItemKey(item) {
    return `${activeLogId}|${item.dateKey}|${item.detailIndex}|${item.paymentDueDate}`;
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

function updateOverdueNotification(announce = false) {
    const overdueItems = getVisibleOverdueNotifications();
    const badge = document.getElementById('overdueNotificationBadge');
    const notificationButton = document.getElementById('notificationBtn');
    if (!badge || !notificationButton) return;

    badge.hidden = overdueItems.length === 0;
    badge.textContent = overdueItems.length > 99 ? '99+' : String(overdueItems.length);
    const label = overdueItems.length > 0 ? `연체 미수금 ${overdueItems.length}건` : '새로운 알림 없음';
    notificationButton.title = label;
    notificationButton.setAttribute('aria-label', label);

    if (!announce || overdueItems.length === 0) return;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const signature = overdueItems
        .map(item => `${item.dateKey}:${item.detailIndex}:${item.paymentDueDate}`)
        .sort()
        .join('|');
    const alertKey = `${todayKey}|${activeLogId}|${signature}`;
    if (localStorage.getItem('lastOverdueReceivableAlert') === alertKey) return;

    localStorage.setItem('lastOverdueReceivableAlert', alertKey);
    const total = overdueItems.reduce((sum, item) => sum + item.fare, 0);
    showToastMessage(`연체 미수금 ${overdueItems.length}건 · ${total.toLocaleString()}원이 있습니다.`);
}

function openOverdueReceivables() {
    const overdueItems = getOverdueReceivableItems();
    if (overdueItems.length === 0) {
        showToastMessage('연체된 미수금이 없습니다.');
        return;
    }
    hideAllPages();
    document.getElementById('receivablesManagementPage').classList.remove('hidden');
    selectReceivableTab('due');
}

function renderNotificationPanel() {
    const container = document.getElementById('notificationPanelList');
    if (!container) return;

    const overdueItems = getVisibleOverdueNotifications()
        .sort((a, b) => a.paymentDueDate.localeCompare(b.paymentDueDate));

    if (overdueItems.length === 0) {
        container.innerHTML = '<div class="notification-panel-empty">현재 확인이 필요한 알림이 없습니다.</div>';
        return;
    }

    container.innerHTML = overdueItems.map(item => `
        <div class="notification-swipe-shell" data-notification-key="${getNotificationItemKey(item)}">
            <div class="notification-delete-backdrop" aria-hidden="true"><span>삭제</span><span>삭제</span></div>
            <button type="button" class="notification-panel-item" onclick="handleNotificationItemClick(event)">
                <div class="notification-panel-item-head">
                    <strong>${escapeDetailText(item.client)}</strong>
                    <span>${getDdayText(item.paymentDueDate)}</span>
                </div>
                <p class="notification-panel-item-message">입금 예정일이 지난 미수금입니다. 정산 내역을 확인해 주세요.</p>
                <div class="notification-panel-item-meta">
                    <span>입금 예정일 ${item.paymentDueDate.replace(/-/g, '.')}</span>
                    <b>${item.fare.toLocaleString()}원</b>
                </div>
            </button>
        </div>
    `).join('');

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

            grouped[groupKey].total += item.fare;
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
            return `
                <div class="receivable-group-card">
                    <div class="receivable-group-head">
                        <div class="receivable-group-title">${group.client}</div>
                        <div class="receivable-group-period">${year}년 ${parseInt(month, 10)}월 운행분</div>
                    </div>
                    <div class="receivable-group-summary">
                        <span class="receivable-summary-label">미수금</span>
                        <strong class="receivable-summary-amount">${group.total.toLocaleString()}원</strong>
                        <span class="receivable-summary-separator" aria-hidden="true">·</span>
                        <span class="receivable-summary-count">${group.count}건</span>
                    </div>
                    <div class="receivable-card-actions">
                        <button type="button" class="receivable-detail-btn" onclick="openReceivableDetail('${encodeURIComponent(group.client).replace(/'/g, '%27')}', '${group.monthKey}')">미수금 상세</button>
                        <button type="button" class="receivable-complete-btn" onclick="markMonthlyReceivablesPaid('${group.client.replace(/'/g, "\\'")}', '${group.monthKey}')">입금 완료 처리</button>
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
        return `
            <div class="receivable-item-card">
                <div class="receivable-item-row">
                    <div>
                        <div class="receivable-item-client">${item.client}</div>
                        <div class="receivable-item-info">${workMonth} 운행분</div>
                        <div class="receivable-item-info">입금 예정일: ${item.paymentDueDate.replace(/-/g, '.')}</div>
                        <div class="receivable-dday">${getDdayText(item.paymentDueDate)}</div>
                    </div>
                    <div class="receivable-item-amount">${item.fare.toLocaleString()}원</div>
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
    const total = items.reduce((sum, item) => sum + item.fare, 0);
    const dueDates = items.map(item => item.paymentDueDate).filter(Boolean).sort();

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

        return `
            <article class="receivable-detail-item">
                <div class="receivable-detail-item-top">
                    <time datetime="${item.workDate}">${item.workDate.replace(/-/g, '.')}</time>
                    <strong>${item.fare.toLocaleString()}원</strong>
                </div>
                <div class="receivable-detail-route">${route}</div>
                <div class="receivable-detail-due">${due}</div>
                ${item.remarks ? `<p class="receivable-detail-remarks">${escapeDetailText(item.remarks)}</p>` : ''}
                <button type="button" class="receivable-item-paid-btn" onclick="markReceivableItemPaid('${item.dateKey}', ${item.detailIndex})">이 건 입금 완료</button>
            </article>`;
    }).join('');
}

function markReceivableItemPaid(dateKey, detailIndex) {
    const detail = workData[dateKey]?.callDetails?.[detailIndex];
    if (!detail || (detail.paymentStatus || '미수') !== '미수') {
        showToastMessage('이미 처리된 내역입니다.');
        return renderReceivableDetail();
    }

    detail.paymentStatus = '수금 완료';
    saveDataToStorage();
    buildCalendar();
    renderReceivableDetail();
    showToastMessage('입금 완료 처리했습니다.');
}

function markCurrentReceivableGroupPaid() {
    if (!currentReceivableDetail) return;
    markMonthlyReceivablesPaid(currentReceivableDetail.clientName, currentReceivableDetail.monthKey, true);
}

function markMonthlyReceivablesPaid(clientName, monthKey, stayOnDetail = false) {
    Object.keys(workData).forEach(dateKey => {
        const record = workData[dateKey];

        if (!record || !record.callDetails) {
            return;
        }

        record.callDetails.forEach(detail => {
            const workDate = detail.workDate || dateKey;

            if (
                (detail.paymentStatus || '미수') === '미수' &&
                (detail.client || '미지정 거래처') === clientName &&
                workDate.slice(0, 7) === monthKey
            ) {
                detail.paymentStatus = '수금 완료';
            }
        });
    });

    saveDataToStorage();
    buildCalendar();
    if (stayOnDetail) renderReceivableDetail();
    else renderReceivablesManagement('monthly');
    showToastMessage(`${clientName} ${parseInt(monthKey.slice(5, 7), 10)}월분 미수금을 수금 완료 처리했습니다.`);
}

// ========== 세금계산서 관리 ==========
let taxInvoiceViewMonth = '';
let currentTaxInvoiceTab = 'draft';

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
}

function getTaxInvoiceRecordId(monthKey, clientName) {
    return `${activeLogId}|${monthKey}|${clientName}`;
}

function getTaxInvoiceSourceGroups(monthKey) {
    const grouped = {};
    const taxClients = new Set((getUserSettings().clients || []).filter(client => client.taxInvoiceEnabled).map(client => client.companyName));
    Object.keys(workData).sort().forEach(dateKey => {
        const details = workData[dateKey]?.callDetails || [];
        details.forEach(detail => {
            const workDate = detail.workDate || dateKey;
            if (!workDate.startsWith(monthKey)) return;
            const clientName = (detail.client || '').trim();
            if (!taxClients.has(clientName)) return;
            const supplyAmount = parseCurrencyValue(detail.fare);
            if (!clientName || supplyAmount <= 0) return;
            if (!grouped[clientName]) grouped[clientName] = { clientName, count: 0, supplyAmount: 0, taxAmount: 0 };
            grouped[clientName].count += 1;
            grouped[clientName].supplyAmount += supplyAmount;
            grouped[clientName].taxAmount += detail.vatExempt ? 0 : Math.round(supplyAmount * .1);
        });
    });
    return Object.values(grouped).map(group => ({ ...group, totalAmount: group.supplyAmount + group.taxAmount }));
}

function getTaxInvoiceClientInfo(clientName) {
    const client = (getUserSettings().clients || []).find(item => item.companyName === clientName) || {};
    return {
        clientBizNumber: client.bizNumber || '',
        clientRepresentative: client.taxRepresentative || client.managerName || '',
        clientAddress: client.taxAddress || '',
        clientBizType: client.taxBizType || '',
        clientBizItem: client.taxBizItem || '',
        clientEmail: client.taxEmail || ''
    };
}

function buildTaxInvoiceEntry(group) {
    const id = getTaxInvoiceRecordId(taxInvoiceViewMonth, group.clientName);
    const saved = getTaxInvoiceRecords().find(item => item.id === id) || {};
    return {
        ...getTaxInvoiceClientInfo(group.clientName),
        itemName: '화물운송료',
        remark: `${parseInt(taxInvoiceViewMonth.slice(5, 7), 10)}월 운행분`,
        ...saved,
        id,
        logId: activeLogId,
        monthKey: taxInvoiceViewMonth,
        clientName: group.clientName,
        count: group.count,
        supplyAmount: group.supplyAmount,
        taxAmount: group.taxAmount,
        totalAmount: group.totalAmount,
        status: saved.status || 'draft'
    };
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
    renderTaxInvoices();
}

function selectTaxInvoiceTab(tab) {
    currentTaxInvoiceTab = tab === 'issued' ? 'issued' : 'draft';
    renderTaxInvoices();
}

function renderTaxInvoices() {
    const settings = getUserSettings();
    const issuerReady = settings.bizName && settings.bizNumber && settings.userName && settings.bizType && settings.bizItem;
    const guide = document.getElementById('taxInvoiceIssuerGuide');
    guide.className = `tax-invoice-guide${issuerReady ? ' ready' : ''}`;
    guide.innerHTML = issuerReady
        ? `<strong>${escapeDetailText(settings.bizName)}</strong><span>${escapeDetailText(settings.bizNumber)} · ${escapeDetailText(settings.bizType)} / ${escapeDetailText(settings.bizItem)}</span>`
        : '<strong>사업자 정보가 필요합니다.</strong><span>오른쪽 위 설정에서 상호, 사업자번호, 대표자, 업태와 종목을 입력해 주세요.</span>';

    const sourceEntries = getTaxInvoiceSourceGroups(taxInvoiceViewMonth).map(buildTaxInvoiceEntry);
    const storedIssued = getTaxInvoiceRecords().filter(item => item.logId === activeLogId && item.monthKey === taxInvoiceViewMonth && item.status === 'issued');
    const issuedById = new Map(storedIssued.map(item => [item.id, item]));
    sourceEntries.forEach(item => { if (item.status === 'issued') issuedById.set(item.id, item); });
    const issuedEntries = [...issuedById.values()];
    const draftEntries = sourceEntries.filter(item => item.status !== 'issued');

    document.getElementById('taxInvoiceDraftCount').textContent = draftEntries.length;
    document.getElementById('taxInvoiceIssuedCount').textContent = issuedEntries.length;
    document.getElementById('taxInvoiceDraftTab').classList.toggle('active', currentTaxInvoiceTab === 'draft');
    document.getElementById('taxInvoiceIssuedTab').classList.toggle('active', currentTaxInvoiceTab === 'issued');

    const entries = currentTaxInvoiceTab === 'issued' ? issuedEntries : draftEntries;
    const supplyTotal = entries.reduce((sum, item) => sum + Number(item.supplyAmount || 0), 0);
    const taxTotal = entries.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
    document.getElementById('taxInvoiceSummary').innerHTML = `<span>${entries.length}건</span><strong>${(supplyTotal + taxTotal).toLocaleString()}원</strong><small>공급가액 ${supplyTotal.toLocaleString()}원 · 세액 ${taxTotal.toLocaleString()}원</small>`;

    const list = document.getElementById('taxInvoiceList');
    if (entries.length === 0) {
        list.innerHTML = `<div class="tax-invoice-empty">${currentTaxInvoiceTab === 'issued' ? '발급 완료한 세금계산서가 없습니다.' : '이 달에 거래처가 입력된 운행내역이 없습니다.'}</div>`;
        return;
    }

    list.innerHTML = entries.map(item => {
        const clientKey = encodeURIComponent(item.clientName).replace(/'/g, '%27');
        const missingInfo = !item.clientBizNumber;
        return `<article class="tax-invoice-card">
            <div class="tax-invoice-card-head"><div><strong>${escapeDetailText(item.clientName)}</strong><span>${item.count || 0}건 · ${missingInfo ? '사업자번호 미입력' : escapeDetailText(item.clientBizNumber)}</span></div><em class="${item.status}">${item.status === 'issued' ? '발급 완료' : '작성 전'}</em></div>
            <div class="tax-invoice-card-money"><span>공급가액 <b>${Number(item.supplyAmount).toLocaleString()}원</b></span><span>세액 <b>${Number(item.taxAmount).toLocaleString()}원</b></span><strong>${Number(item.totalAmount).toLocaleString()}원</strong></div>
            <div class="tax-invoice-card-actions">
                <button type="button" onclick="openTaxInvoiceDraft('${clientKey}')">${item.status === 'issued' ? '내용 보기' : '작성하기'}</button>
                <button type="button" onclick="exportTaxInvoiceCsv('${clientKey}')">엑셀 저장</button>
                ${item.status === 'issued' ? `<button type="button" onclick="changeTaxInvoiceStatus('${clientKey}', 'draft')">발급 취소</button>` : `<button type="button" class="primary" onclick="changeTaxInvoiceStatus('${clientKey}', 'issued')">발급 완료</button>`}
            </div>
        </article>`;
    }).join('');
}

function findCurrentTaxInvoice(clientName) {
    const group = getTaxInvoiceSourceGroups(taxInvoiceViewMonth).find(item => item.clientName === clientName);
    if (group) return buildTaxInvoiceEntry(group);
    return getTaxInvoiceRecords().find(item => item.id === getTaxInvoiceRecordId(taxInvoiceViewMonth, clientName));
}

function openTaxInvoiceDraft(encodedClientName) {
    const clientName = decodeURIComponent(encodedClientName);
    const item = findCurrentTaxInvoice(clientName);
    if (!item) return;
    document.getElementById('taxInvoiceRecordId').value = item.id;
    document.getElementById('taxInvoiceClientName').value = item.clientName;
    document.getElementById('taxInvoiceClientBizNumber').value = item.clientBizNumber || '';
    document.getElementById('taxInvoiceClientRepresentative').value = item.clientRepresentative || '';
    document.getElementById('taxInvoiceClientEmail').value = item.clientEmail || '';
    document.getElementById('taxInvoiceClientAddress').value = item.clientAddress || '';
    document.getElementById('taxInvoiceClientBizType').value = item.clientBizType || '';
    document.getElementById('taxInvoiceClientBizItem').value = item.clientBizItem || '';
    document.getElementById('taxInvoiceDate').value = item.issueDate || `${taxInvoiceViewMonth}-${String(new Date(Number(taxInvoiceViewMonth.slice(0,4)), Number(taxInvoiceViewMonth.slice(5,7)), 0).getDate()).padStart(2, '0')}`;
    document.getElementById('taxInvoiceItemName').value = item.itemName || '화물운송료';
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
    const clientName = document.getElementById('taxInvoiceClientName').value;
    const current = findCurrentTaxInvoice(clientName);
    return {
        ...current,
        id,
        logId: activeLogId,
        monthKey: taxInvoiceViewMonth,
        clientName,
        clientBizNumber: document.getElementById('taxInvoiceClientBizNumber').value.trim(),
        clientRepresentative: document.getElementById('taxInvoiceClientRepresentative').value.trim(),
        clientEmail: document.getElementById('taxInvoiceClientEmail').value.trim(),
        clientAddress: document.getElementById('taxInvoiceClientAddress').value.trim(),
        clientBizType: document.getElementById('taxInvoiceClientBizType').value.trim(),
        clientBizItem: document.getElementById('taxInvoiceClientBizItem').value.trim(),
        issueDate: document.getElementById('taxInvoiceDate').value,
        itemName: document.getElementById('taxInvoiceItemName').value.trim() || '화물운송료',
        remark: document.getElementById('taxInvoiceRemark').value.trim(),
        status: current?.status || 'draft',
        updatedAt: new Date().toISOString()
    };
}

function persistTaxInvoice(item) {
    const records = getTaxInvoiceRecords();
    const index = records.findIndex(record => record.id === item.id);
    if (index >= 0) records[index] = item;
    else records.push(item);
    saveTaxInvoiceRecords(records);
}

function saveTaxInvoiceClientInfo(item) {
    const settings = getUserSettings();
    const client = (settings.clients || []).find(entry => entry.companyName === item.clientName);
    if (!client) return;
    client.bizNumber = item.clientBizNumber;
    client.taxRepresentative = item.clientRepresentative;
    client.taxEmail = item.clientEmail;
    client.taxAddress = item.clientAddress;
    client.taxBizType = item.clientBizType;
    client.taxBizItem = item.clientBizItem;
    setUserSettings(settings);
}

function saveTaxInvoiceDraft() {
    const item = collectTaxInvoiceForm();
    if (!item.clientBizNumber || !item.issueDate) {
        showConfirmModal('공급받는 자의 사업자등록번호와 작성일자를 입력해 주세요.', null);
        return;
    }
    persistTaxInvoice(item);
    saveTaxInvoiceClientInfo(item);
    closeTaxInvoiceModal();
    renderTaxInvoices();
    showToastMessage('세금계산서 작성 내용을 저장했습니다.');
}

function changeTaxInvoiceStatus(encodedClientName, status) {
    const clientName = decodeURIComponent(encodedClientName);
    const item = findCurrentTaxInvoice(clientName);
    if (!item) return;
    if (status === 'issued') {
        const settings = getUserSettings();
        if (!settings.bizName || !settings.bizNumber || !settings.userName) {
            showConfirmModal('먼저 개인정보에서 공급자 사업자 정보를 입력해 주세요.', null);
            return;
        }
        if (!item.clientBizNumber) {
            openTaxInvoiceDraft(encodedClientName);
            showToastMessage('거래처 사업자등록번호를 먼저 입력해 주세요.');
            return;
        }
    }
    item.status = status;
    item.issuedAt = status === 'issued' ? new Date().toISOString() : '';
    persistTaxInvoice(item);
    renderTaxInvoices();
    showToastMessage(status === 'issued' ? '발급 완료로 표시했습니다.' : '작성 전 상태로 되돌렸습니다.');
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
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

async function exportTaxInvoiceCsv(encodedClientName) {
    const clientName = decodeURIComponent(encodedClientName);
    const item = findCurrentTaxInvoice(clientName);
    const settings = getUserSettings();
    if (!item || !settings.bizNumber || !item.clientBizNumber) {
        showConfirmModal('공급자와 공급받는 자의 사업자등록번호를 먼저 입력해 주세요.', null);
        return;
    }
    const issueDate = item.issueDate || `${taxInvoiceViewMonth}-01`;
    const filename = `${taxInvoiceViewMonth}_${item.clientName}_세금계산서.xlsx`.replace(/[\\/:*?"<>|]/g, '_');

    try {
        const ExcelJS = await loadTaxInvoiceExcelLibrary();
        const workbook = new ExcelJS.Workbook();
        workbook.creator = settings.bizName || '운행일지';
        workbook.created = new Date();
        workbook.subject = `${taxInvoiceViewMonth} 화물운송료`;

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
        const labelFill = 'FFF3F5F9';
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
        setTaxCell('B3','등록번호',supplierLabelFill,true); setTaxCell('C3',settings.bizNumber || '',supplierFill);
        setTaxCell('D3','종사업자\n번호',supplierLabelFill,true); setTaxCell('E3','',supplierFill);
        setTaxCell('B4','상호\n(법인명)',supplierLabelFill,true); setTaxCell('C4',settings.bizName || '',supplierFill);
        setTaxCell('D4','대표자',supplierLabelFill,true); setTaxCell('E4',settings.userName || '',supplierFill);
        setTaxCell('B5','사업장 주소',supplierLabelFill,true); sheet.mergeCells('C5:E5'); setTaxCell('C5',settings.bizAddress || '',supplierFill);
        setTaxCell('B6','업태',supplierLabelFill,true); setTaxCell('C6',settings.bizType || '',supplierFill);
        setTaxCell('D6','종목',supplierLabelFill,true); setTaxCell('E6',settings.bizItem || '',supplierFill);
        setTaxCell('B7','이메일',supplierLabelFill,true); sheet.mergeCells('C7:E7'); setTaxCell('C7',settings.bizEmail || '',supplierFill);

        setTaxCell('G3','등록번호',buyerLabelFill,true); setTaxCell('H3',item.clientBizNumber || '',buyerFill);
        setTaxCell('I3','종사업자\n번호',buyerLabelFill,true); setTaxCell('J3','',buyerFill);
        setTaxCell('G4','상호\n(법인명)',buyerLabelFill,true); setTaxCell('H4',item.clientName || '',buyerFill);
        setTaxCell('I4','대표자',buyerLabelFill,true); setTaxCell('J4',item.clientRepresentative || '',buyerFill);
        setTaxCell('G5','사업장 주소',buyerLabelFill,true); sheet.mergeCells('H5:J5'); setTaxCell('H5',item.clientAddress || '',buyerFill);
        setTaxCell('G6','업태',buyerLabelFill,true); setTaxCell('H6',item.clientBizType || '',buyerFill);
        setTaxCell('I6','종목',buyerLabelFill,true); setTaxCell('J6',item.clientBizItem || '',buyerFill);
        setTaxCell('G7','이메일',buyerLabelFill,true); sheet.mergeCells('H7:J7'); setTaxCell('H7',item.clientEmail || '',buyerFill);
        sheet.mergeCells('A8:B8'); sheet.getCell('A8').value='작성일자';
        sheet.mergeCells('C8:D8'); sheet.getCell('C8').value='공급가액';
        sheet.mergeCells('E8:F8'); sheet.getCell('E8').value='세액';
        sheet.mergeCells('G8:J8'); sheet.getCell('G8').value='수정사유';
        sheet.mergeCells('A9:B9'); sheet.getCell('A9').value=issueDate;
        sheet.mergeCells('C9:D9'); sheet.getCell('C9').value=Number(item.supplyAmount);
        sheet.mergeCells('E9:F9'); sheet.getCell('E9').value=Number(item.taxAmount);
        sheet.mergeCells('G9:J9'); sheet.getCell('G9').value='';
        sheet.mergeCells('A10:B10'); sheet.getCell('A10').value='비고';
        const invoiceCar = activeLogId === 'main'
            ? (settings.cars || []).find(car => car.type === 'main')
            : (settings.cars || []).find(car => car.number === activeLogId);
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
        const uploadRow = [issueDate,settings.bizNumber,settings.bizName,settings.userName,settings.bizAddress,settings.bizType,settings.bizItem,settings.bizEmail,item.clientBizNumber,item.clientName,item.clientRepresentative,item.clientAddress,item.clientBizType,item.clientBizItem,item.clientEmail,item.itemName || '화물운송료',1,Number(item.supplyAmount),Number(item.taxAmount),Number(item.totalAmount),item.remark];
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
        showConfirmModal('엑셀 파일 생성 모듈을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.', null);
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
        document.getElementById('clientBizNumber').value = client.bizNumber || '';
        document.getElementById('clientPhone').value = client.phone || '';
        document.getElementById('clientTaxInvoiceToggle').checked = !!client.taxInvoiceEnabled;
        document.getElementById('clientTaxRepresentative').value = client.taxRepresentative || client.managerName || '';
        document.getElementById('clientTaxEmail').value = client.taxEmail || '';
        document.getElementById('clientTaxAddress').value = client.taxAddress || '';
        document.getElementById('clientTaxBizType').value = client.taxBizType || '';
        document.getElementById('clientTaxBizItem').value = client.taxBizItem || '';
        toggleClientTaxInvoice();
        document.getElementById('clientPinnedToggle').checked = !!client.isPinned;
        toggleClientPinned();

        document.getElementById('clientCommToggle').checked = !!client.commEnabled;
        setClientCommType(client.commType || 'percent');
        document.getElementById('clientCommValue').value = client.commValue || '';
        toggleClientComm();

        const savedPaymentTerm = client.paymentTerm || 'next_month_end';
        document.getElementById('clientPaymentTerm').value = savedPaymentTerm === 'second_month_end' ? 'second_month_day' : savedPaymentTerm;
        document.getElementById('clientPaymentTermValue').value = savedPaymentTerm === 'second_month_end' ? '31' : (client.paymentTermValue || '');
    } else {
        document.getElementById('clientModalTitle').textContent = '거래처 등록';
        document.getElementById('clientCompanyName').value = '';
        document.getElementById('clientManagerName').value = '';
        document.getElementById('clientBizNumber').value = '';
        document.getElementById('clientPhone').value = '';
        document.getElementById('clientTaxInvoiceToggle').checked = false;
        document.getElementById('clientTaxRepresentative').value = '';
        document.getElementById('clientTaxEmail').value = '';
        document.getElementById('clientTaxAddress').value = '';
        document.getElementById('clientTaxBizType').value = '';
        document.getElementById('clientTaxBizItem').value = '';
        toggleClientTaxInvoice();
        document.getElementById('clientPinnedToggle').checked = false;
        toggleClientPinned();

        document.getElementById('clientCommToggle').checked = false;
        setClientCommType('percent');
        document.getElementById('clientCommValue').value = '';

        document.getElementById('clientPaymentTerm').value = 'next_month_end';
        document.getElementById('clientPaymentTermValue').value = '';
        toggleClientComm();
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
    const taxInvoiceEnabled = document.getElementById('clientTaxInvoiceToggle').checked;
    const taxRepresentative = document.getElementById('clientTaxRepresentative').value.trim();
    const taxEmail = document.getElementById('clientTaxEmail').value.trim();
    const taxAddress = document.getElementById('clientTaxAddress').value.trim();
    const taxBizType = document.getElementById('clientTaxBizType').value.trim();
    const taxBizItem = document.getElementById('clientTaxBizItem').value.trim();
    const isPinned = document.getElementById('clientPinnedToggle').checked;
    const commEnabled = isPinned ? document.getElementById('clientCommToggle').checked : false;
    const commType = document.getElementById('clientCommType').value;
    const commValue = document.getElementById('clientCommValue').value.trim();
    const paymentTerm = document.getElementById('clientPaymentTerm').value;
    const paymentTermValue = document.getElementById('clientPaymentTermValue').value.trim();

    if (!companyName) {
        showConfirmModal('거래처명을 입력해 주세요.', null);
        return;
    }

    if (taxInvoiceEnabled && !bizNumber) {
        showConfirmModal('세금계산서를 사용하려면 사업자 번호를 입력해 주세요.', null);
        return;
    }

    if (commEnabled && !commValue) {
        showConfirmModal('수수료 수치 또는 금액을 입력해 주세요.', null);
        return;
    }

    if ((paymentTerm === 'next_month_day' || paymentTerm === 'second_month_day') && (!paymentTermValue || parseInt(paymentTermValue, 10) < 1 || parseInt(paymentTermValue, 10) > 31)) {
        showConfirmModal('입금일은 1일부터 31일 사이로 입력해 주세요.', null);
        return;
    }

    if (paymentTerm === 'after_days' && paymentTermValue === '') {
        showConfirmModal('운행 후 경과일을 입력해 주세요.', null);
        return;
    }

    const settings = getUserSettings();

    if (!settings.clients) {
        settings.clients = [];
    }

    const previousClient = editingClientIndex >= 0 ? (settings.clients[editingClientIndex] || {}) : {};
    const clientData = {
        ...previousClient,
        companyName,
        managerName,
        bizNumber,
        phone,
        taxInvoiceEnabled,
        taxRepresentative,
        taxEmail,
        taxAddress,
        taxBizType,
        taxBizItem,
        isPinned,
        commEnabled,
        commType,
        commValue,
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
