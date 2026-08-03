import { loadWorkData, saveWorkData, loadSettingsData, saveSettingsData, loadTheme, saveTheme } from './storage.js';
import { viewDate, initCalendarDOM, buildCalendar, changeMonth } from './calendar.js';
import { openModal, closeModal, toggleOffState, addCallInputRow, openMaintDetailModal, closeMaintDetailModal, addMaintDetailInputRow, saveMaintDetails, selectedDateKey, isOffSelected, currentSelectedFixedCount, currentTempMaintItems } from './modal.js';

let workData = loadWorkData();
let previousPage = 'main';

// --- 전역 함수 바인딩 (HTML 인라인 이벤트에서 접근 가능하도록 window 객체에 연결) ---
window.changeMonth = (delta) => {
    changeMonth(delta);
    buildCalendar(workData);
};
window.toggleMenu = () => document.getElementById('dropdownMenu').classList.toggle('hidden');
window.showMain = showMain;
window.showPersonalPage = showPersonalPage;
window.showSettings = showSettings;
window.goBackFromSettings = goBackFromSettings;
window.showReport = showReport;
window.toggleTheme = toggleTheme;
window.toggleFixedSubSettings = toggleFixedSubSettings;
window.togglePalletSubSettings = togglePalletSubSettings;
window.toggleBtnConfigContainer = toggleBtnConfigContainer;
window.renderButtonConfigInputs = renderButtonConfigInputs;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.savePersonalSettings = savePersonalSettings;
window.exportData = exportData;
window.importData = importData;
window.downloadPDF = downloadPDF;
window.toggleOffState = toggleOffState;
window.addCallInputRow = addCallInputRow;
window.openMaintDetailModal = openMaintDetailModal;
window.closeMaintDetailModal = closeMaintDetailModal;
window.addMaintDetailInputRow = addMaintDetailInputRow;
window.saveMaintDetails = saveMaintDetails;
window.closeModal = closeModal;
window.confirmWorkRecord = confirmWorkRecord;
window.formatPhoneNumber = formatPhoneNumber;
window.formatCurrencyInput = formatCurrencyInput;

// 외부 영역 클릭 시 메뉴 닫기
document.addEventListener('click', function(e) {
    const btnGroup = document.querySelector('.top-btn-group');
    const menu = document.getElementById('dropdownMenu');
    if (btnGroup && !btnGroup.contains(e.target) && menu && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
    }
});

// 달력 날짜 클릭 시 핸들러
function handleCellClick(dateKey, month, day) {
    openModal(dateKey, month, day, workData);
}

// 텍스트 포맷 유틸리티
function parseCurrencyValue(str) {
    if (!str) return 0;
    return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0;
}

function formatCurrencyInput(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    input.value = value ? parseInt(value, 10).toLocaleString() : '';
}

function formatPhoneNumber(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    if (value.length < 4) input.value = value;
    else if (value.length < 7) input.value = `${value.slice(0, 3)}-${value.slice(3)}`;
    else if (value.length < 11) input.value = `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
    else input.value = `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7, 11)}`;
}

// 토스트 메시지
function showToastMessage(msg = "저장되었습니다.") {
    const toast = document.getElementById('toastMessage');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1200);
}

// --- 근무 기록 조립 및 저장 로직 ---
function confirmWorkRecord() {
    const savedSettings = loadSettingsData();
    let fixedCount = 0;
    let palletCount = 0;
    let callFares = [];

    if (!isOffSelected) {
        if (savedSettings.fixedOn) {
            fixedCount = currentSelectedFixedCount || 0;
            if (savedSettings.palletOn) {
                palletCount = parseInt(document.getElementById('modalPalletCount').value, 10) || 0;
            }
        }
        if (savedSettings.callOn) {
            document.querySelectorAll('.call-fare-input').forEach(input => {
                if (input.value.trim() !== '') callFares.push(input.value.trim());
            });
        }
    }

    const maintItems = currentTempMaintItems;

    if (!isOffSelected && fixedCount === 0 && palletCount === 0 && callFares.length === 0 && maintItems.length === 0) {
        delete workData[selectedDateKey];
    } else {
        workData[selectedDateKey] = { isOff: isOffSelected, fixedCount, palletCount, callFares, maintItems };
        showToastMessage("저장되었습니다!");
    }

    saveWorkData(workData);
    closeModal();
    buildCalendar(workData);
}

// --- 페이지 전환 관리 ---
function hideAllPages() {
    document.getElementById('mainPage').classList.add('hidden');
    document.getElementById('settingsPage').classList.add('hidden');
    document.getElementById('personalPage').classList.add('hidden');
    document.getElementById('reportPage').classList.add('hidden');
    document.getElementById('dropdownMenu').classList.add('hidden');
    document.getElementById('pdfDownloadBtn').style.display = 'none';
}

function showMain() {
    hideAllPages();
    document.getElementById('mainPage').classList.remove('hidden');
    document.getElementById('menuReportBtn').style.display = 'block';
    document.getElementById('menuMainBtn').style.display = 'none';
}

function showPersonalPage() {
    hideAllPages();
    document.getElementById('personalPage').classList.remove('hidden');
}

function showSettings(fromPage) {
    if (fromPage) previousPage = fromPage;
    loadSettings();
    hideAllPages();
    document.getElementById('settingsPage').classList.remove('hidden');
}

function goBackFromSettings() {
    loadSettings();
    if (previousPage === 'report') showReport();
    else showMain();
}

function showReport() {
    hideAllPages();
    document.getElementById('reportPage').classList.remove('hidden');
    document.getElementById('pdfDownloadBtn').style.display = 'flex';
    document.getElementById('menuReportBtn').style.display = 'none';
    document.getElementById('menuMainBtn').style.display = 'block';
    buildReportPage(false);
}

// --- 운송 내역서(Report) 생성 로직 ---
function createTableHTML(items, showPallet) {
    let bodyHTML = '';
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth() + 1;

    items.forEach(item => {
        const palletStr = item.palletCount > 0 ? `${item.palletCount}장` : '-';
        const workStr = item.isOff ? '휴무' : `${item.workVal}회`;
        bodyHTML += `
            <tr>
                <td>${currentYear}.${currentMonth}.${item.day}</td>
                <td>${workStr}</td>
                ${showPallet ? `<td>${palletStr}</td>` : ''}
                <td class="amount">${item.amount.toLocaleString()}원</td>
            </tr>`;
    });

    return `
        <table class="report-table">
            <thead>
                <tr>
                    <th style="width: ${showPallet ? '30%' : '35%'};">날짜</th>
                    <th style="width: ${showPallet ? '20%' : '25%'};">운행</th>
                    ${showPallet ? '<th style="width: 20%;">파렛트</th>' : ''}
                    <th style="width: ${showPallet ? '30%' : '40%'};">금액</th>
                </tr>
            </thead>
            <tbody>${bodyHTML}</tbody>
        </table>`;
}

function buildReportPage(isForExport = false) {
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();

    document.getElementById('reportMonthTitle').textContent = `${currentYear}년 ${currentMonth + 1}월 운송 내역서`;

    const savedSettings = loadSettingsData();
    document.getElementById('rptUserName').textContent = savedSettings.userName || '-';
    document.getElementById('rptUserPhone').textContent = savedSettings.userPhone || '-';
    document.getElementById('rptCarNumber').textContent = savedSettings.carNumber || '-';
    document.getElementById('rptCarTonnage').textContent = savedSettings.carTonnage || '-';
    document.getElementById('rptBankName').textContent = savedSettings.bankName || '-';
    document.getElementById('rptAccountNumber').textContent = savedSettings.accountNumber || '-';

    const fixedUnitPrice = parseCurrencyValue(savedSettings.unitPrice);
    const palletUnitPrice = parseCurrencyValue(savedSettings.palletPrice);
    const showPallet = !!(savedSettings.fixedOn && savedSettings.palletOn);

    let workList = [];
    let totalFare = 0;
    let totalPalletFare = 0;

    for (let d = 1; d <= lastDate; d++) {
        const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = workData[dateKey];

        if (record === 'off' || (record && record.isOff)) {
            workList.push({ day: d, isOff: true, workVal: 0, palletCount: 0, amount: 0 });
        } else if (record && typeof record === 'object') {
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

            const dayPalletFare = dayPalletCount * palletUnitPrice;

            if (dayWorkCount > 0 || dayPalletCount > 0) {
                totalFare += dayFare;
                totalPalletFare += dayPalletFare;
                workList.push({ day: d, isOff: false, workVal: dayWorkCount, palletCount: dayPalletCount, amount: dayFare + dayPalletFare });
            }
        }
    }

    const container = document.getElementById('reportTableContainer');
    container.innerHTML = '';

    if (workList.length === 0) {
        container.innerHTML = `<table class="report-table"><tbody><tr><td style="text-align:center; padding: 15px; color: var(--sub-text-color);">해당 월의 운송 내역이 없습니다.</td></tr></tbody></table>`;
    } else if (isForExport) {
        const half = Math.ceil(workList.length / 2);
        container.innerHTML = `
            <div class="report-split-container">
                <div class="report-split-column">${createTableHTML(workList.slice(0, half), showPallet)}</div>
                <div class="report-split-column">${createTableHTML(workList.slice(half), showPallet)}</div>
            </div>`;
    } else {
        container.innerHTML = createTableHTML(workList, showPallet);
    }

    const totalVat = Math.round((totalFare + totalPalletFare) * 0.1);
    const grandTotal = totalFare + totalPalletFare + totalVat;

    document.getElementById('rptFare').textContent = `${totalFare.toLocaleString()} 원`;
    const rptPalletRow = document.getElementById('rptPalletTotalRow');
    if (showPallet) {
        rptPalletRow.style.display = 'flex';
        document.getElementById('rptPalletFare').textContent = `${totalPalletFare.toLocaleString()} 원`;
    } else {
        rptPalletRow.style.display = 'none';
    }
    document.getElementById('rptVat').textContent = `${totalVat.toLocaleString()} 원`;
    document.getElementById('rptTotal').textContent = `${grandTotal.toLocaleString()} 원`;
}

// --- 설정 및 서브 설정 토글 ---
function toggleFixedSubSettings() {
    const checked = document.getElementById('fixedToggle').checked;
    document.getElementById('fixedSubSettings').style.display = checked ? 'block' : 'none';
}

function togglePalletSubSettings() {
    const checked = document.getElementById('palletToggle').checked;
    document.getElementById('palletSubSettings').style.display = checked ? 'flex' : 'none';
}

function toggleBtnConfigContainer() {
    const isHide = document.getElementById('hideBtnCountToggle').checked;
    document.getElementById('btnValuesContainer').style.display = isHide ? 'none' : 'block';
}

function renderButtonConfigInputs(savedValues = null) {
    const count = parseInt(document.getElementById('btnCountInput').value, 10) || 3;
    const container = document.getElementById('btnValuesContainer');
    const currentInputs = document.querySelectorAll('.btn-val-input');
    const currentValues = Array.from(currentInputs).map(input => parseInt(input.value, 10) || 1);

    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'btn-config-row';
        let defaultVal = currentValues[i] !== undefined ? currentValues[i] : (savedValues?.[i] ?? i + 1);
        row.innerHTML = `
            <span style="font-size:0.9rem; font-weight:600;">버튼 ${i + 1} 운행 횟수:</span>
            <input type="number" class="input-box btn-val-input" inputmode="numeric" style="width: 90px; text-align: center;" value="${defaultVal}" min="1">
            <span style="font-size:0.9rem;">회</span>
        `;
        container.appendChild(row);
    }
}

function saveSettings() {
    const btnInputs = document.querySelectorAll('.btn-val-input');
    const buttonValues = Array.from(btnInputs).map(input => parseInt(input.value, 10) || 1);
    const settings = loadSettingsData();

    settings.fixedOn = document.getElementById('fixedToggle').checked;
    settings.unitPrice = document.getElementById('unitPrice').value;
    settings.btnCount = document.getElementById('btnCountInput').value || 3;
    settings.buttonValues = buttonValues;
    settings.hideBtnCount = document.getElementById('hideBtnCountToggle').checked;
    settings.palletOn = document.getElementById('palletToggle').checked;
    settings.palletPrice = document.getElementById('palletPrice').value;
    settings.callOn = document.getElementById('callToggle').checked;

    saveSettingsData(settings);
    showToastMessage("저장되었습니다.");
    buildCalendar(workData);
}

function savePersonalSettings() {
    const settings = loadSettingsData();
    settings.userName = document.getElementById('userName').value;
    settings.userPhone = document.getElementById('userPhone').value;
    settings.carNumber = document.getElementById('carNumber').value;
    settings.carTonnage = document.getElementById('carTonnage').value;
    settings.bankName = document.getElementById('bankName').value;
    settings.accountNumber = document.getElementById('accountNumber').value;

    saveSettingsData(settings);
    showToastMessage("저장되었습니다.");
}

function resetSettings() {
    if (confirm("경고: 설정 및 저장된 모든 데이터가 초기화되며 복구할 수 없습니다.\n\n정말 초기화하시겠습니까?")) {
        localStorage.clear();
        showToastMessage("초기화되었습니다.");
        setTimeout(() => location.reload(), 500);
    }
}

function exportData() {
    const backupData = {
        userSettings: loadSettingsData(),
        workData: loadWorkData(),
        theme: loadTheme()
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `운송내역_백업_${new Date().toISOString().slice(0, 10)}.json`);
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
            if (imported.userSettings) saveSettingsData(imported.userSettings);
            if (imported.workData) {
                saveWorkData(imported.workData);
                workData = imported.workData;
            }
            if (imported.theme) saveTheme(imported.theme);
            showToastMessage('복원되었습니다!');
            loadSettings();
            buildCalendar(workData);
        } catch (err) {
            alert('올바르지 않은 백업 파일입니다.');
        }
    };
    reader.readAsText(file);
}

async function downloadPDF() {
    const element = document.getElementById('reportContentToExport');
    document.body.classList.add('pdf-export-mode');
    buildReportPage(true);
    await new Promise(resolve => setTimeout(resolve, 50));

    const opt = {
        margin: [12, 10, 12, 10],
        filename: `${viewDate.getFullYear()}년_${viewDate.getMonth() + 1}월_운송내역서.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(element).save();
    } finally {
        document.body.classList.remove('pdf-export-mode');
        buildReportPage(false);
    }
}

function setTheme(theme) {
    const iconContainer = document.getElementById('themeIcon');
    const textContainer = document.getElementById('themeText');
    if (theme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        if (iconContainer) iconContainer.innerHTML = `<svg class="inline-icon sm" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        if (textContainer) textContainer.textContent = '다크 모드';
    } else {
        document.body.removeAttribute('data-theme');
        if (iconContainer) iconContainer.innerHTML = `<svg class="inline-icon sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        if (textContainer) textContainer.textContent = '라이트 모드';
    }
}

function toggleTheme() {
    const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    saveTheme(newTheme);
}

function loadSettings() {
    setTheme(loadTheme());
    const savedSettings = loadSettingsData();
    if (savedSettings && Object.keys(savedSettings).length > 0) {
        document.getElementById('fixedToggle').checked = !!savedSettings.fixedOn;
        document.getElementById('unitPrice').value = savedSettings.unitPrice || '';
        document.getElementById('btnCountInput').value = savedSettings.btnCount || 3;
        document.getElementById('hideBtnCountToggle').checked = !!savedSettings.hideBtnCount;
        renderButtonConfigInputs(savedSettings.buttonValues || [1, 2, 3]);
        toggleBtnConfigContainer();

        document.getElementById('palletToggle').checked = !!savedSettings.palletOn;
        document.getElementById('palletPrice').value = savedSettings.palletPrice || '';
        document.getElementById('callToggle').checked = !!savedSettings.callOn;

        document.getElementById('userName').value = savedSettings.userName || '';
        document.getElementById('userPhone').value = savedSettings.userPhone || '';
        document.getElementById('carNumber').value = savedSettings.carNumber || '';
        document.getElementById('carTonnage').value = savedSettings.carTonnage || '';
        document.getElementById('bankName').value = savedSettings.bankName || '';
        document.getElementById('accountNumber').value = savedSettings.accountNumber || '';

        toggleFixedSubSettings();
        togglePalletSubSettings();
    } else {
        renderButtonConfigInputs([1, 2, 3]);
    }
}

// --- 앱 초기화 구동 ---
document.addEventListener('DOMContentLoaded', () => {
    setTheme(loadTheme());
    loadSettings();
    initCalendarDOM(handleCellClick);
    buildCalendar(workData);
    
    setInterval(() => {
        const now = new Date();
        const timeStr = String(now.getHours()).padStart(2, '0') + ':' + 
                        String(now.getMinutes()).padStart(2, '0') + ':' + 
                        String(now.getSeconds()).padStart(2, '0');
        const clockElem = document.getElementById('currentTime');
        if (clockElem) clockElem.textContent = timeStr;
    }, 1000);
});