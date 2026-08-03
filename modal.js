import { loadSettingsData } from './storage.js';

export let selectedDateKey = null;
export let isOffSelected = false;
export let currentSelectedFixedCount = 0;
export let currentTempMaintItems = [];

function parseCurrencyValue(str) {
    if (!str) return 0;
    return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0;
}

export function openModal(dateKey, month, day, workData) {
    selectedDateKey = dateKey;
    document.getElementById('modalTitle').textContent = `${month}월 ${day}일 운송 내역 입력`;

    const savedSettings = loadSettingsData();
    document.getElementById('modalFixedSection').style.display = savedSettings.fixedOn ? 'block' : 'none';
    document.getElementById('modalPalletSection').style.display = (savedSettings.fixedOn && savedSettings.palletOn) ? 'block' : 'none';
    document.getElementById('modalCallSection').style.display = savedSettings.callOn ? 'block' : 'none';

    renderFixedCountButtons(savedSettings.buttonValues || [1, 2, 3]);

    const record = workData[dateKey];
    const callContainer = document.getElementById('callListContainer');
    callContainer.innerHTML = '';
    
    // 배열 초기화
    currentTempMaintItems.length = 0;

    if (record === 'off' || (record && record.isOff)) {
        setOffState(true);
        selectFixedCount(0);
        document.getElementById('modalPalletCount').value = '';
    } else if (record && typeof record === 'object') {
        setOffState(false);
        selectFixedCount(record.fixedCount || 0);
        document.getElementById('modalPalletCount').value = record.palletCount || '';

        if (record.callFares) {
            record.callFares.forEach(val => addCallInputRow(val));
        }
        if (record.maintItems) {
            const parsedItems = JSON.parse(JSON.stringify(record.maintItems));
            parsedItems.forEach(item => currentTempMaintItems.push(item));
        }
    } else {
        setOffState(false);
        selectFixedCount(0);
        document.getElementById('modalPalletCount').value = '';
    }

    renderMaintSummaryInMainModal();
    document.getElementById('workModal').classList.remove('hidden');
}

export function closeModal() {
    document.getElementById('workModal').classList.add('hidden');
}

export function toggleOffState() {
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

export function selectFixedCount(val) {
    currentSelectedFixedCount = val;
    document.querySelectorAll('.fixed-count-btn').forEach(btn => {
        if (parseInt(btn.dataset.val, 10) === val && val !== 0) {
            btn.classList.add('active-work');
        } else {
            btn.classList.remove('active-work');
        }
    });
}

function renderFixedCountButtons(values) {
    const container = document.getElementById('fixedCountBtnContainer');
    container.innerHTML = '';

    values.forEach((val) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toggle-btn fixed-count-btn';
        btn.dataset.val = val;
        btn.textContent = `${val}회`;
        btn.onclick = () => {
            selectFixedCount(currentSelectedFixedCount === val ? 0 : val);
            if (isOffSelected) setOffState(false);
        };
        container.appendChild(btn);
    });
}

export function addCallInputRow(val = '') {
    if (isOffSelected) setOffState(false);
    const container = document.getElementById('callListContainer');
    const div = document.createElement('div');
    div.className = 'call-item-row';
    div.innerHTML = `
        <input type="text" class="input-box call-fare-input" inputmode="numeric" placeholder="운임비 입력" value="${val}" oninput="formatCurrencyInput(this);">
        <button type="button" class="btn-del" onclick="this.parentElement.remove()">삭제</button>
    `;
    container.appendChild(div);
}

export function openMaintDetailModal() {
    const listContainer = document.getElementById('maintDetailListContainer');
    listContainer.innerHTML = '';
    if (currentTempMaintItems.length > 0) {
        currentTempMaintItems.forEach(item => addMaintDetailInputRow(item.name, item.fare));
    } else {
        addMaintDetailInputRow();
    }
    document.getElementById('maintDetailModal').classList.remove('hidden');
}

export function closeMaintDetailModal() {
    document.getElementById('maintDetailModal').classList.add('hidden');
}

export function addMaintDetailInputRow(name = '', fare = '') {
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

export function saveMaintDetails() {
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

    currentTempMaintItems.length = 0;
    newItems.forEach(item => currentTempMaintItems.push(item));
    
    renderMaintSummaryInMainModal();
    closeMaintDetailModal();
}

export function renderMaintSummaryInMainModal() {
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