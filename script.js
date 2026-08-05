let viewDate = new Date(); 
let maintViewDate = new Date();
let selectedDateKey = null; 
let activeLogId = 'main';
let workData = JSON.parse(localStorage.getItem('workData')) || {}; 
let previousPage = 'main'; 
let isOffSelected = false; 
let currentTempMaintItems = []; 
let currentTempCallDetails = []; 

let isDetailReportView = false; 
let currentDetailClientFilter = 'ALL'; 

const calendarCells = []; 
let confirmCallback = null;

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
function setUserSettings(settings) {
    localStorage.setItem('userSettings', JSON.stringify(settings));
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
            
            if (activeLogId === car.number) {
                btn.style.cssText = 'display: flex; align-items: center; gap: 10px; color: var(--sub-text-color); padding-right: 0; opacity: 0.4; cursor: default;';
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    ${shortNum} 운행일지
                `;
            } else {
                btn.style.cssText = 'display: flex; align-items: center; gap: 10px; color: var(--sub-text-color); padding-right: 0;';
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    ${shortNum} 운행일지
                `;
                btn.onclick = () => switchCarLog(car.number);
            }

            const gearBtn = document.createElement('button');
            gearBtn.className = 'menu-item-gear';
            gearBtn.title = "보조 운행일지 설정";
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
}

function showSubCarSettings(carNum) {
    previousPage = 'main'; 
    hideAllPages();
    loadSettings(); 
    document.getElementById('subCarSettingsPage').classList.remove('hidden');
    document.getElementById('subCarSettingsTitle').innerText = `${getShortCarNum(carNum)} 운행 일지 설정`;
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
                callDetails: []
            };
            dataChanged = true;
        } else if (!workData[key].callDetails) {
            workData[key].callDetails = [];
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

function changeYearMonth() {
    const y = parseInt(document.getElementById('yearSelect').value, 10);
    const m = parseInt(document.getElementById('monthSelect').value, 10);
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

function hideAllPages() {
    document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
    
    document.getElementById('sideMenu').classList.remove('open');
    document.getElementById('sideMenuOverlay').classList.remove('show');
    
    document.getElementById('pdfDownloadBtn').style.display = 'none';
    
    const pdfGroup = document.getElementById('pdfDropdownGroup');
    if (pdfGroup) pdfGroup.style.display = 'none';
    const pdfMenu = document.getElementById('pdfMenuDropdown');
    if (pdfMenu) pdfMenu.classList.remove('show');

    const backBtn = document.getElementById('subCarBackBtn');
    if (backBtn) backBtn.style.display = 'none';
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
    
    const backBtn = document.getElementById('subCarBackBtn');
    if (backBtn && activeLogId !== 'main') {
        backBtn.style.display = 'flex'; 
    }

    document.getElementById('menuReportBtn').style.display = 'flex';
}

function showPersonalInfo() {
    hideAllPages();
    document.getElementById('personalInfoPage').classList.remove('hidden');
}

function showCarManagement() {
    hideAllPages();
    document.getElementById('carManagementPage').classList.remove('hidden');
    loadCarList();
}

function showClientManagement() {
    hideAllPages();
    document.getElementById('clientManagementPage').classList.remove('hidden');
    renderClientList(); 
}

let editingClientIndex = -1;

function renderClientList() {
    const settings = getUserSettings();
    const clients = settings.clients || [];
    const container = document.getElementById('clientListContainer');
    container.innerHTML = '';

    if (clients.length === 0) {
        container.innerHTML = '<div class="empty-state">등록된 화주/주선 업체가 없습니다.</div>';
        return;
    }

    clients.forEach((client, idx) => {
        let commBadge = '';
        if (client.commEnabled) {
            const badgeText = client.commType === 'direct' ? `${client.commValue}원` : `${client.commValue}%`;
            commBadge = `<span style="font-size:0.75rem; color:#c05621; background:#feebc8; padding:2px 6px; border-radius:4px; margin-left:6px;">수수료 ${badgeText}</span>`;
        }

        const div = document.createElement('div');
        div.className = 'car-card'; 
        div.innerHTML = `
            <div>
                <div class="car-info-text">${client.companyName} ${client.managerName ? '(' + client.managerName + ')' : ''} ${commBadge}</div>
                <div class="car-sub-text">사업자: ${client.bizNumber || '-'} | 연락처: ${client.phone || '-'}</div>
            </div>
            <div class="car-action-btns">
                <button class="btn-edit" onclick="openClientModal(${idx})">수정</button>
                <button class="btn-del" style="padding: 8px 12px;" onclick="deleteClient(${idx})">삭제</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function toggleClientComm() {
    const isChecked = document.getElementById('clientCommToggle').checked;
    document.getElementById('clientCommSection').style.display = isChecked ? 'block' : 'none';
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
        document.getElementById('clientModalTitle').textContent = '화주/주선 업체 수정';
        document.getElementById('clientCompanyName').value = clients[index].companyName || '';
        document.getElementById('clientManagerName').value = clients[index].managerName || '';
        document.getElementById('clientBizNumber').value = clients[index].bizNumber || '';
        document.getElementById('clientPhone').value = clients[index].phone || '';
        
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
        document.getElementById('clientModalTitle').textContent = '화주/주선 업체 등록';
        document.getElementById('clientCompanyName').value = '';
        document.getElementById('clientManagerName').value = '';
        document.getElementById('clientBizNumber').value = '';
        document.getElementById('clientPhone').value = '';
        
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

function saveClient() {
    const companyName = document.getElementById('clientCompanyName').value.trim();
    const managerName = document.getElementById('clientManagerName').value.trim();
    const bizNumber = document.getElementById('clientBizNumber').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();

    const commEnabled = document.getElementById('clientCommToggle').checked;
    const commTypeEl = document.getElementById('clientCommType');
    const commType = commTypeEl ? commTypeEl.value : 'percent';
    const commValue = document.getElementById('clientCommValue').value.trim();

    if (!companyName) {
        alert('업체명을 입력해주세요.');
        return;
    }
    if (commEnabled && !commValue) {
        alert('수수료 수치/금액을 입력해주세요.');
        return;
    }

    const settings = getUserSettings();
    if (!settings.clients) settings.clients = [];

    const clientData = { companyName, managerName, bizNumber, phone, commEnabled, commType, commValue };

    if (editingClientIndex >= 0) {
        settings.clients[editingClientIndex] = clientData;
        showToastMessage('수정되었습니다.');
    } else {
        settings.clients.push(clientData);
        showToastMessage('등록되었습니다.');
    }

    setUserSettings(settings);
    closeClientModal();
    renderClientList();
    buildCalendar(); 
}

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
                ? '<span style="color:var(--primary-color); font-size:0.8rem; border:1px solid var(--primary-color); padding:2px 4px; border-radius:4px; margin-right:6px;">메인</span>' 
                : '<span style="color:var(--sub-text-color); font-size:0.8rem; border:1px solid var(--border-color); padding:2px 4px; border-radius:4px; margin-right:6px;">보조</span>';
            
            const div = document.createElement('div');
            div.className = 'car-card';
            div.innerHTML = `
                <div>
                    <div class="car-info-text">${typeBadge}${car.number}</div>
                    <div class="car-sub-text">${car.tonnage ? '(' + car.tonnage + ')' : ''}</div>
                </div>
                <div class="car-action-btns">
                    <button class="btn-edit" onclick="editCar(${idx})">수정</button>
                    <button class="btn-del" style="padding: 8px 12px;" onclick="deleteCar(${idx})">삭제</button>
                </div>
            `;
            container.appendChild(div);
        });
    }
}

function openCarModal() {
    resetCarForm();
    document.getElementById('carModalTitle').textContent = '차량 등록';
    document.getElementById('carModal').classList.remove('hidden');
}

function closeCarModal() {
    document.getElementById('carModal').classList.add('hidden');
    resetCarForm();
}

function handleCarTypeToggle(type) {
    const mainToggle = document.getElementById('mainCarToggle');
    const subToggle = document.getElementById('subCarToggle');
    
    const settings = getUserSettings();
    const cars = settings.cars || [];
    
    let mainCount = 0;
    let subCount = 0;
    
    cars.forEach((c, idx) => {
        if (idx !== editingCarIndex) {
            if (c.type === 'main') mainCount++;
            else subCount++;
        }
    });

    if (type === 'main' && mainToggle.checked) {
        subToggle.checked = false;
        if (mainCount >= 1) {
            alert('메인 차량이 이미 등록되어 있습니다.');
            mainToggle.checked = false;
        }
    } else if (type === 'sub' && subToggle.checked) {
        mainToggle.checked = false;
        if (subCount >= 3) {
            alert('보조 차량은 최대 3대까지 등록 가능합니다.');
            subToggle.checked = false;
        }
    }

    const logContainer = document.getElementById('logToggleContainer');
    if (subToggle.checked) {
        logContainer.style.display = 'block';
    } else {
        logContainer.style.display = 'none';
    }
}

function saveNewCar() {
    const num = document.getElementById('newCarNumber').value.trim();
    const ton = document.getElementById('newCarTonnage').value.trim();
    const isMain = document.getElementById('mainCarToggle').checked;
    const isSub = document.getElementById('subCarToggle').checked;
    
    if (!num) return alert('차량번호를 입력하세요.');
    if (!isMain && !isSub) return alert('메인 차량 또는 보조 차량 선택을 활성화해 주세요.');

    const carType = isMain ? 'main' : 'sub';
    const settings = getUserSettings();
    if (!settings.cars) settings.cars = [];

    const logEnabled = isMain ? true : document.getElementById('newLogToggle').checked;
    const commission = document.getElementById('newCarCommission').value.trim();
    
    let infoType = 'existing';
    let personalInfo = null;

    if (isSub && logEnabled) {
        const isNewInfo = document.getElementById('btnUseNewInfo').classList.contains('active-work');
        if (isNewInfo) {
            infoType = 'new';
            personalInfo = {
                name: document.getElementById('newUserName').value,
                phone: document.getElementById('newUserPhone').value,
                bank: document.getElementById('newBankName').value,
                account: document.getElementById('newAccountNumber').value
            };
        }
    }

    const carData = { 
        number: num, 
        tonnage: ton, 
        type: carType,
        logEnabled: logEnabled,
        infoType: infoType,
        personalInfo: personalInfo,
        commission: commission
    };

    if (editingCarIndex > -1) {
        settings.cars[editingCarIndex] = carData; 
        showToastMessage('차량 정보가 수정되었습니다.');
    } else {
        settings.cars.push(carData); 
        showToastMessage('차량이 등록되었습니다.');
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
    hideAllPages();
    document.getElementById('maintManagementPage').classList.remove('hidden');
    
    maintViewDate = new Date(viewDate.getTime());
    updateMaintDateSelects();
    renderMaintList();
}

function updateMaintDateSelects() {
    document.getElementById('maintYearSelect').value = maintViewDate.getFullYear();
    document.getElementById('maintMonthSelect').value = maintViewDate.getMonth();
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

function renderMaintList() {
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
                    <div style="display:flex; gap: 6px;">
                        <button class="btn-del" style="background:var(--sub-text-color); padding:6px 10px; min-height:auto;" onclick="openMaintRecordModal('${date}', ${item.index})">수정</button>
                        <button class="btn-del" style="padding:6px 10px; min-height:auto;" onclick="deleteMaintRecord('${date}', ${item.index})">삭제</button>
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
    if (date !== null && index !== null) {
        document.getElementById('maintRecordModalTitle').textContent = '정비 내역 수정';
        document.getElementById('maintRecordDate').value = date;
        document.getElementById('maintRecordName').value = workData[date].maintItems[index].name;
        document.getElementById('maintRecordFare').value = parseCurrencyValue(workData[date].maintItems[index].fare).toLocaleString();
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
        
        document.getElementById('maintRecordName').value = '';
        document.getElementById('maintRecordFare').value = '';
        document.getElementById('maintRecordOriginalDate').value = '';
        document.getElementById('maintRecordOriginalIndex').value = '';
    }
    document.getElementById('maintRecordModal').classList.remove('hidden');
}

function closeMaintRecordModal() {
    document.getElementById('maintRecordModal').classList.add('hidden');
}

function saveMaintRecord() {
    const date = document.getElementById('maintRecordDate').value; 
    const name = document.getElementById('maintRecordName').value.trim();
    const fare = document.getElementById('maintRecordFare').value.trim();
    const origDate = document.getElementById('maintRecordOriginalDate').value;
    const origIndex = document.getElementById('maintRecordOriginalIndex').value;

    if (!date) return alert('날짜를 선택하세요.');
    if (!name && !fare) return alert('정비 항목명 또는 비용을 입력하세요.');

    if (origDate && origIndex !== '') {
        workData[origDate].maintItems.splice(parseInt(origIndex, 10), 1);
    }

    if (!workData[date]) {
        workData[date] = { isOff: false, fixedCount: 0, palletCount: 0, callFares: [], maintItems: [], callDetails: [] };
    }
    if (!workData[date].maintItems) {
        workData[date].maintItems = [];
    }

    workData[date].maintItems.push({ name: name, fare: fare });
    
    saveDataToStorage(); 
    closeMaintRecordModal();
    
    const updatedDate = new Date(date);
    maintViewDate.setFullYear(updatedDate.getFullYear());
    maintViewDate.setMonth(updatedDate.getMonth());
    updateMaintDateSelects();
    renderMaintList();
    
    showToastMessage('저장되었습니다.');
    buildCalendar(); 
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

function showSettings(fromPage) {
    if (fromPage) previousPage = fromPage;
    loadSettings();
    hideAllPages();
    document.getElementById('settingsPage').classList.remove('hidden');
}

function goBackFromSettings() {
    loadSettings();
    if (previousPage === 'report') {
        showReport();
    } else {
        showMain();
    }
}

function showReport() {
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

    document.getElementById('menuReportBtn').style.display = 'none';
    
    isDetailReportView = false;
    buildReportPage(false); 
}

function handleReportBack() {
    if (isDetailReportView) {
        isDetailReportView = false;
        buildReportPage(false);
    } else {
        showMain();
    }
}

function openReportCarSelectModal(cars) {
    const listContainer = document.getElementById('reportCarSelectList');
    listContainer.innerHTML = '';

    cars.forEach(car => {
        if (car.type === 'main' || (car.type === 'sub' && car.logEnabled)) {
            const btn = document.createElement('button');
            btn.className = 'btn-add'; 
            btn.style.borderColor = 'var(--primary-color)';
            btn.style.color = 'var(--primary-color)';
            btn.style.fontWeight = '700';
            
            let displayName = car.type === 'main' ? `메인차량(${car.number})` : `보조차량(${car.number})`;
            btn.textContent = displayName;
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
    document.getElementById('fixedSubSettings').style.display = checked ? 'block' : 'none';
}

function toggleSubFixedSettings() {
    const checked = document.getElementById('subFixedToggle').checked;
    const subFixedSection = document.getElementById('subFixedSubSettings');
    if(subFixedSection) subFixedSection.style.display = checked ? 'block' : 'none';
}

function togglePalletSubSettings() {
    const checked = document.getElementById('palletToggle').checked;
    document.getElementById('palletSubSettings').style.display = checked ? 'flex' : 'none';
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
    document.getElementById('subPalletSubSettings').style.display = checked ? 'flex' : 'none';
}

function showToastMessage(msg = "저장되었습니다.") {
    const toast = document.getElementById('toastMessage');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 1200);
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
    settings.callOn = document.getElementById('callToggle').checked;
    
    settings.callDetailOn = document.getElementById('callDetailToggle').checked;

    if (document.getElementById('subFixedToggle')) {
        const subInputModeBtn = document.getElementById('btnSubInputModeFare');
        if (subInputModeBtn) {
            settings.subInputMode = subInputModeBtn.classList.contains('active-work') ? 'fare' : 'count';
        }

        settings.subFixedOn = document.getElementById('subFixedToggle').checked;
        settings.subUnitPrice = document.getElementById('subUnitPrice').value;
        
        settings.subPalletOn = document.getElementById('subPalletToggle').checked;
        settings.subPalletPrice = document.getElementById('subPalletPrice').value;

        settings.subCallOn = document.getElementById('subCallToggle').checked;
        
        settings.subCallDetailOn = document.getElementById('subCallDetailToggle').checked;
    }

    setUserSettings(settings);
    buildCalendar(); 
}

function savePersonalInfo() {
    const settings = getUserSettings();
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

        document.getElementById('callToggle').checked = !!savedSettings.callOn;
        
        document.getElementById('callDetailToggle').checked = !!savedSettings.callDetailOn;

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

            document.getElementById('subCallToggle').checked = !!savedSettings.subCallOn;
            
            document.getElementById('subCallDetailToggle').checked = !!savedSettings.subCallDetailOn;
            
            toggleSubFixedSettings();
            toggleSubPalletSubSettings();
        }

        document.getElementById('userName').value = savedSettings.userName || '';
        document.getElementById('userPhone').value = savedSettings.userPhone || '';
        document.getElementById('bankName').value = savedSettings.bankName || '';
        document.getElementById('accountNumber').value = savedSettings.accountNumber || '';

        toggleFixedSubSettings();
        togglePalletSubSettings();
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
            alert('올바르지 않은 백업 파일입니다.');
        }
    };
    reader.readAsText(file);
}

function changeMonth(delta) {
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
    }

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const totalWeeks = Math.ceil((firstDay + lastDate) / 7);
    const totalVisibleCells = totalWeeks * 7;

    let monthTotalWork = 0;
    let monthTotalFare = 0;
    let monthTotalPalletFare = 0;
    let monthTotalMaintFare = 0;
    let monthTotalCommission = 0;

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
        
        const oldBadges = cell.querySelectorAll('.work-badge, .off-badge, .maint-badge');
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

                if (record.fixedCount > 0) {
                    dayWorkCount += parseInt(record.fixedCount, 10);
                    dayFare += record.fixedCount * fixedUnitPrice;
                }
                
                if (record.palletCount > 0 && activeFixedOn && activePalletOn) {
                    dayPalletFare += record.palletCount * palletUnitPrice;
                }
                
                if (record.callFares && record.callFares.length > 0) {
                    dayWorkCount += record.callFares.length;
                    const callSum = record.callFares.reduce((a, b) => a + parseCurrencyValue(b), 0);
                    dayFare += callSum;
                }
                
                if (record.callDetails && record.callDetails.length > 0) {
                    dayWorkCount += record.callDetails.length;
                    record.callDetails.forEach(detail => {
                        let gross = parseCurrencyValue(detail.fare);
                        let comm = 0;
                        if (detail.client) {
                            const clientObj = savedSettings.clients?.find(c => c.companyName === detail.client);
                            if (clientObj && clientObj.commEnabled) {
                                if (clientObj.commType === 'percent' || !clientObj.commType) {
                                    comm = Math.floor(gross * (parseFloat(clientObj.commValue) / 100));
                                } else {
                                    comm = parseCurrencyValue(clientObj.commValue);
                                }
                            }
                        }
                        dayFare += gross;
                        monthTotalCommission += comm;
                    });
                }

                if (dayWorkCount > 0) {
                    monthTotalWork += dayWorkCount;
                    monthTotalFare += dayFare;

                    const badge = document.createElement('span');
                    badge.classList.add('work-badge');
                    
                    if (displayMode === 'fare') {
                        badge.textContent = formatFareShort(dayFare + dayPalletFare);
                    } else {
                        badge.textContent = `${dayWorkCount}회`;
                    }
                    
                    cell.appendChild(badge);
                } else if (dayPalletFare > 0) {
                    monthTotalPalletFare += dayPalletFare;
                    
                    if (displayMode === 'fare') {
                        const badge = document.createElement('span');
                        badge.classList.add('work-badge');
                        badge.textContent = formatFareShort(dayPalletFare);
                        cell.appendChild(badge);
                    }
                }

                if (record.maintItems && record.maintItems.length > 0) {
                    const maintSum = record.maintItems.reduce((a, b) => a + parseCurrencyValue(b.fare), 0);
                    if (maintSum > 0) {
                        monthTotalMaintFare += maintSum;
                        const maintBadge = document.createElement('span');
                        maintBadge.classList.add('maint-badge');
                        maintBadge.textContent = formatFareShort(maintSum);
                        cell.appendChild(maintBadge);
                    }
                }
            }
        } else {
            cell.classList.add('empty');
        }
    }

    let subCarComm = 0;
    let subCarCommLabel = '보조차량 수수료';
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars?.find(c => c.number === activeLogId);
        if (currentCar && currentCar.logEnabled && currentCar.commission) {
            const commPercent = parseFloat(currentCar.commission);
            if (!isNaN(commPercent) && commPercent > 0) {
                // 수정된 수식: 기본 운송료 및 파렛트 요금 합계에서 화주/업체 수수료를 차감한 후 계산
                subCarComm = Math.floor((monthTotalFare + monthTotalPalletFare - monthTotalCommission) * (commPercent / 100));
                subCarCommLabel = `${getShortCarNum(currentCar.number)} 차량 ${commPercent}%`;
            }
        }
    }

    updateSummary(monthTotalWork, monthTotalFare, monthTotalPalletFare, monthTotalMaintFare, monthTotalCommission, subCarComm, subCarCommLabel);
}

function updateSummary(totalCount, fareTotal, palletTotal, maintTotal, commissionTotal = 0, subCarComm = 0, subCarCommLabel = '') {
    document.getElementById('summaryTotalWork').textContent = `총 ${totalCount}회 운행`;
    document.getElementById('summaryFare').textContent = `${fareTotal.toLocaleString()} 원`;

    const commRow = document.getElementById('summaryCommissionRow');
    if (commissionTotal > 0) {
        commRow.style.display = 'flex';
        document.getElementById('summaryCommissionFare').textContent = `- ${commissionTotal.toLocaleString()} 원`;
    } else {
        commRow.style.display = 'none';
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
}

function openModal(dateKey, month, day) {
    selectedDateKey = dateKey;
    document.getElementById('modalTitle').textContent = `${month}월 ${day}일 운송 내역 입력`;

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

    const record = workData[dateKey];
    const callContainer = document.getElementById('callListContainer');
    callContainer.innerHTML = '';

    currentTempMaintItems = [];
    currentTempCallDetails = [];

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
        if (record.callDetails && record.callDetails.length > 0) {
            currentTempCallDetails = JSON.parse(JSON.stringify(record.callDetails));
        }
    } else {
        setOffState(false);
        document.getElementById('modalFixedCountInput').value = '';
        document.getElementById('modalPalletCount').value = '';
    }

    renderMaintSummaryInMainModal();
    renderCallDetailSummaryInMainModal();
    document.getElementById('workModal').classList.remove('hidden');
}

function toggleOffState() {
    setOffState(!isOffSelected);
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

function addCallInputRow(val = '') {
    if (isOffSelected) setOffState(false);
    const container = document.getElementById('callListContainer');
    const div = document.createElement('div');
    div.className = 'call-item-row';
    div.innerHTML = `
        <input type="text" class="input-box call-fare-input" inputmode="numeric" placeholder="운송료 입력" value="${val}" oninput="formatCurrencyInput(this);">
        <button type="button" class="btn-del" onclick="this.parentElement.remove()">삭제</button>
    `;
    container.appendChild(div);
}

function renderCallDetailSummaryInMainModal() {
    const container = document.getElementById('callDetailSummaryContainer');
    const listCard = document.getElementById('callDetailSummaryList');

    if (currentTempCallDetails.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
    } else {
        container.style.display = 'block';
        let html = '';
        let total = 0;
        currentTempCallDetails.forEach((item, index) => {
            const fareVal = parseCurrencyValue(item.fare);
            total += fareVal;
            html += `
                <div class="maint-summary-item" style="align-items: flex-start; padding-bottom:8px; margin-bottom:8px; border-bottom:1px solid var(--border-color);">
                    <div style="flex:1;">
                        <div style="font-weight: 700; color: var(--primary-color); margin-bottom: 4px;">
                            ${item.loadLoc || '상차지 미상'} ➔ ${item.unloadLoc || '하차지 미상'}
                        </div>
                        <div style="font-size: 0.85rem; color: var(--sub-text-color);">
                            운송료: ${fareVal.toLocaleString()}원 | 화주/주선 업체: ${item.client || '-'}
                        </div>
                    </div>
                    <div style="display:flex; gap: 4px;">
                        <button type="button" class="btn-del" style="background:var(--sub-text-color); padding:4px 8px; font-size:0.8rem; min-height:auto;" onclick="openCallDetailModal(${index})">수정</button>
                        <button type="button" class="btn-del" style="padding:4px 8px; font-size:0.8rem; min-height:auto;" onclick="deleteCallDetail(${index})">삭제</button>
                    </div>
                </div>
            `;
        });
        html += `
            <div class="maint-summary-item" style="margin-top: 6px; padding-top: 6px; font-weight:800; color: var(--primary-color);">
                <span>세부 내역 합계 (${currentTempCallDetails.length}건)</span>
                <span>${total.toLocaleString()}원</span>
            </div>
        `;
        listCard.innerHTML = html;
    }
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

function openCallDetailModal(index = -1) {
    if (isOffSelected) setOffState(false);
    
    populateClientDataList();
    populateLocationDataLists();

    document.getElementById('callDetailEditIndex').value = index;
    if (index >= 0 && currentTempCallDetails[index]) {
        const item = currentTempCallDetails[index];
        document.getElementById('callLoadLoc').value = item.loadLoc || '';
        document.getElementById('callUnloadLoc').value = item.unloadLoc || '';
        document.getElementById('callDetailFare').value = parseCurrencyValue(item.fare).toLocaleString() || '';
        document.getElementById('callClient').value = item.client || '';
        document.getElementById('callRemarks').value = item.remarks || '';
    } else {
        document.getElementById('callLoadLoc').value = '';
        document.getElementById('callUnloadLoc').value = '';
        document.getElementById('callDetailFare').value = '';
        document.getElementById('callClient').value = '';
        document.getElementById('callRemarks').value = '';
    }
    document.getElementById('callDetailModal').classList.remove('hidden');
    calculateCallDetailComm();
}

function closeCallDetailModal() {
    document.getElementById('callDetailModal').classList.add('hidden');
}

function saveCallDetail() {
    const idx = parseInt(document.getElementById('callDetailEditIndex').value, 10);
    const loadLoc = document.getElementById('callLoadLoc').value.trim();
    const unloadLoc = document.getElementById('callUnloadLoc').value.trim();
    const fare = document.getElementById('callDetailFare').value.trim();
    const client = document.getElementById('callClient').value.trim();
    const remarks = document.getElementById('callRemarks').value.trim();

    if (!fare && !loadLoc && !unloadLoc) {
        alert("최소한 운송료나 상/하차지는 입력해야 합니다.");
        return;
    }

    const newItem = { loadLoc, unloadLoc, fare, client, remarks };

    if (idx >= 0) {
        currentTempCallDetails[idx] = newItem;
    } else {
        currentTempCallDetails.push(newItem);
    }

    renderCallDetailSummaryInMainModal();
    closeCallDetailModal();
}

function deleteCallDetail(index) {
    showConfirmModal('삭제하시겠습니까?', () => {
        currentTempCallDetails.splice(index, 1);
        renderCallDetailSummaryInMainModal();
    });
}

function renderMaintSummaryInMainModal() {
    const container = document.getElementById('maintSummaryContainer');
    const listCard = document.getElementById('maintSummaryList');

    if (currentTempMaintItems.length === 0) {
        container.style.display = 'none';
        listCard.innerHTML = '';
    } else {
        container.style.display = 'block';
        let html = '';
        let total = 0;
        currentTempMaintItems.forEach(item => {
            const fareVal = parseCurrencyValue(item.fare);
            total += fareVal;
            html += `
                <div class="maint-summary-item">
                    <span style="display:flex; align-items:center; gap:4px;">
                        <svg class="inline-icon sm" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                        ${item.name || '정비 항목'}
                    </span>
                    <span style="font-weight: 700;">${fareVal.toLocaleString()}원</span>
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

function openMaintDetailModal() {
    const listContainer = document.getElementById('maintDetailListContainer');
    listContainer.innerHTML = '';

    if (currentTempMaintItems.length > 0) {
        currentTempMaintItems.forEach(item => {
            addMaintDetailInputRow(item.name, item.fare);
        });
    } else {
        addMaintDetailInputRow();
    }

    document.getElementById('maintDetailModal').classList.remove('hidden');
}

function closeMaintDetailModal() {
    document.getElementById('maintDetailModal').classList.add('hidden');
}

function addMaintDetailInputRow(name = '', fare = '') {
    const container = document.getElementById('maintDetailListContainer');
    const div = document.createElement('div');
    div.className = 'maint-item-row';
    div.innerHTML = `
        <input type="text" class="input-box maint-name-input" placeholder="정비 항목명" value="${name}">
        <input type="text" class="input-box maint-fare-input" inputmode="numeric" placeholder="비용" value="${fare}" oninput="formatCurrencyInput(this);" style="text-align: right;">
        <button type="button" class="btn-del" onclick="this.parentElement.remove()">삭제</button>
    `;
    container.appendChild(div);
}

function saveMaintDetails() {
    const nameInputs = document.querySelectorAll('.maint-name-input');
    const fareInputs = document.querySelectorAll('.maint-fare-input');

    const newItems = [];
    for (let i = 0; i < nameInputs.length; i++) {
        const name = nameInputs[i].value.trim();
        const fare = fareInputs[i].value.trim();
        if (name || fare) {
            newItems.push({ name, fare });
        }
    }

    currentTempMaintItems = newItems;
    renderMaintSummaryInMainModal();
    closeMaintDetailModal();
}

function closeModal() {
    document.getElementById('workModal').classList.add('hidden');
}

function confirmWorkRecord() {
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
    const callDetails = currentTempCallDetails;

    if (!isOffSelected && fixedCount === 0 && palletCount === 0 && callFares.length === 0 && maintItems.length === 0 && callDetails.length === 0) {
        delete workData[selectedDateKey];
    } else {
        workData[selectedDateKey] = {
            isOff: isOffSelected,
            fixedCount,
            palletCount,
            callFares,
            maintItems,
            callDetails
        };
        showToastMessage("저장되었습니다!");
    }

    saveDataToStorage(); 
    closeModal();
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

                if (record.fixedCount > 0) {
                    dayWorkCount += parseInt(record.fixedCount, 10);
                    dayFare += record.fixedCount * fixedUnitPrice;
                }
                if (record.callFares && record.callFares.length > 0) {
                    dayWorkCount += record.callFares.length;
                    dayFare += record.callFares.reduce((a, b) => a + parseCurrencyValue(b), 0);
                }

                if (record.callDetails && record.callDetails.length > 0) {
                    dayWorkCount += record.callDetails.length;
                    record.callDetails.forEach(detail => {
                        let gross = parseCurrencyValue(detail.fare);
                        let comm = 0;
                        if (detail.client) {
                            const clientObj = savedSettings.clients?.find(c => c.companyName === detail.client);
                            if (clientObj && clientObj.commEnabled) {
                                if (clientObj.commType === 'percent' || !clientObj.commType) {
                                    comm = Math.floor(gross * (parseFloat(clientObj.commValue) / 100));
                                } else {
                                    comm = parseCurrencyValue(clientObj.commValue);
                                }
                            }
                        }
                        dayFare += gross;
                        totalCommission += comm;
                    });
                }

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
    let subCarCommLabel = '보조차량 수수료';
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars?.find(c => c.number === activeLogId);
        if (currentCar && currentCar.logEnabled && currentCar.commission) {
            const commPercent = parseFloat(currentCar.commission);
            if (!isNaN(commPercent) && commPercent > 0) {
                // 수정된 수식: 기본 운송료 및 파렛트 요금 합계에서 화주/업체 수수료를 차감한 후 계산
                subCarComm = Math.floor((totalFare + totalPalletFare - totalCommission) * (commPercent / 100));
                subCarCommLabel = `${getShortCarNum(currentCar.number)}차량 ${commPercent}%`;
            }
        }
    }

    const totalVat = Math.round((totalFare + totalPalletFare) * 0.1);
    
    // 숨겨진 수수료들도 계에서 정상 차감되도록 수식 반영
    const grandTotal = totalFare + totalPalletFare - totalCommission - subCarComm + totalVat;

    const summaryBox = document.querySelector('.report-summary-box');
    
    // 이외금지 (기본운송료 -> 부가세 -> 계 순서 외에 표출 제한)
    summaryBox.innerHTML = `
        <div class="summary-row">
            <span>기본 운송료</span>
            <span class="summary-value" id="rptFare">${totalFare.toLocaleString()} 원</span>
        </div>
        <div class="summary-row">
            <span>부가세 (10%)</span>
            <span class="summary-value" id="rptVat">${totalVat.toLocaleString()} 원</span>
        </div>
        <div class="summary-row total">
            <span>계</span>
            <span class="summary-value" id="rptTotal">${grandTotal.toLocaleString()} 원</span>
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

function createDetailTableHTML(items, isForExport, totalItems) {
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

    return `
        <table class="report-table" style="font-size: ${fontSize};">
            <thead>
                <tr>
                    <th style="width: 12%; padding: ${cellPadding};">날짜</th>
                    <th style="width: 27%; padding: ${cellPadding};">상차지</th>
                    <th style="width: 27%; padding: ${cellPadding};">하차지</th>
                    <th style="width: 17%; padding: ${cellPadding};">화주/주선</th>
                    <th style="width: 17%; padding: ${cellPadding};">금액</th>
                </tr>
            </thead>
            <tbody>
                ${items.length > 0 ? items.map(item => `
                    <tr>
                        <td style="padding: ${cellPadding}; white-space: nowrap;">${item.dateStr}</td>
                        <td style="padding: ${cellPadding}; white-space: normal; word-break: break-all;">${item.loadLoc}</td>
                        <td style="padding: ${cellPadding}; white-space: normal; word-break: break-all;">${item.unloadLoc}</td>
                        <td style="padding: ${cellPadding}; white-space: normal; word-break: break-all;">${item.client}</td>
                        <td class="amount" style="padding: ${cellPadding}; white-space: nowrap;">${item.fare.toLocaleString()}원</td>
                    </tr>
                `).join('') : `<tr><td colspan="5" style="text-align:center; padding: 15px;">해당 내역이 없습니다.</td></tr>`}
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

    for (let d = 1; d <= lastDate; d++) {
        const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = workData[dateKey];
        if (record && !record.isOff && record.callDetails && record.callDetails.length > 0) {
            record.callDetails.forEach(item => {
                const clientName = item.client || '미지정';
                if (clientFilter === 'ALL' || clientFilter === clientName) {
                    const fareVal = parseCurrencyValue(item.fare);
                    
                    let comm = 0;
                    if (item.client) {
                        const clientObj = savedSettings.clients?.find(c => c.companyName === item.client);
                        if (clientObj && clientObj.commEnabled) {
                            if (clientObj.commType === 'percent' || !clientObj.commType) {
                                comm = Math.floor(fareVal * (parseFloat(clientObj.commValue) / 100));
                            } else {
                                comm = parseCurrencyValue(clientObj.commValue);
                            }
                        }
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

    if (isForExport && detailsList.length > 15) {
        const half = Math.ceil(detailsList.length / 2);
        const leftList = detailsList.slice(0, half);
        const rightList = detailsList.slice(half);

        tableHTML = `
            <div class="report-split-container">
                <div class="report-split-column">${createDetailTableHTML(leftList, true, detailsList.length)}</div>
                <div class="report-split-column">${rightList.length > 0 ? createDetailTableHTML(rightList, true, detailsList.length) : ''}</div>
            </div>`;
    } else {
        tableHTML = createDetailTableHTML(detailsList, isForExport, detailsList.length);
    }

    const clientText = clientFilter === 'ALL' ? '전체' : clientFilter;
    document.getElementById('reportMonthTitle').textContent = `${currentYear}년 ${currentMonth + 1}월 운송비 내역서 (${clientText})`;
    document.getElementById('reportTableContainer').innerHTML = tableHTML;
    
    let subCarComm = 0;
    let subCarCommLabel = '보조차량 수수료';
    if (activeLogId !== 'main') {
        const currentCar = savedSettings.cars?.find(c => c.number === activeLogId);
        if (currentCar && currentCar.logEnabled && currentCar.commission) {
            const commPercent = parseFloat(currentCar.commission);
            if (!isNaN(commPercent) && commPercent > 0) {
                // 수정된 수식: 기본 운송료에서 화주/업체 수수료를 차감한 후 계산
                subCarComm = Math.floor((totalFare - totalCommission) * (commPercent / 100));
                subCarCommLabel = `${getShortCarNum(currentCar.number)}차량 ${commPercent}%`;
            }
        }
    }

    const vat = Math.round(totalFare * 0.1);
    
    // 숨겨진 수수료들도 계에서 정상 차감되도록 수식 반영
    const grandTotal = totalFare - totalCommission - subCarComm + vat;

    const summaryBox = document.querySelector('.report-summary-box');
    
    // 이외금지 (기본운송료 -> 부가세 -> 계 순서 외에 표출 제한)
    summaryBox.innerHTML = `
        <div class="summary-row">
            <span>기본 운송료</span>
            <span class="summary-value" id="rptFare">${totalFare.toLocaleString()} 원</span>
        </div>
        <div class="summary-row">
            <span>부가세 (10%)</span>
            <span class="summary-value" id="rptVat">${vat.toLocaleString()} 원</span>
        </div>
        <div class="summary-row total">
            <span>계</span>
            <span class="summary-value" id="rptTotal">${grandTotal.toLocaleString()} 원</span>
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
    document.getElementById('newLogSettings').style.display = isChecked ? 'block' : 'none';
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
    document.getElementById('mainCarToggle').checked = false;
    document.getElementById('subCarToggle').checked = false;
    document.getElementById('logToggleContainer').style.display = 'none';
    document.getElementById('newLogToggle').checked = false;
    toggleNewLogSettings();
    document.getElementById('newCarCommission').value = ''; 
    selectInfoType('existing');
    document.getElementById('newUserName').value = '';
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
    
    if (car.type === 'main') {
        document.getElementById('mainCarToggle').checked = true;
        document.getElementById('subCarToggle').checked = false;
        document.getElementById('logToggleContainer').style.display = 'none';
    } else {
        document.getElementById('mainCarToggle').checked = false;
        document.getElementById('subCarToggle').checked = true;
        document.getElementById('logToggleContainer').style.display = 'block';
    }
    
    if (car.logEnabled) {
        document.getElementById('newLogToggle').checked = true;
        toggleNewLogSettings();
        if (car.infoType === 'new') {
            selectInfoType('new');
            if (car.personalInfo) {
                document.getElementById('newUserName').value = car.personalInfo.name || '';
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

    document.getElementById('newCarCommission').value = car.commission || ''; 

    document.getElementById('carModalTitle').textContent = '차량 정보 수정';
    document.getElementById('carModal').classList.remove('hidden');
}

// 앱 초기화 구문
normalizeLegacyData(); 
loadSettings();
initDateSelects();
initMaintDateSelects(); 
initCalendarDOM();
buildCalendar();
renderSubCarMenu();