import { loadSettingsData } from './storage.js';

export let viewDate = new Date();
export const calendarCells = [];

function parseCurrencyValue(str) {
    if (!str) return 0;
    return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0;
}

export function initCalendarDOM(onClickCallback) {
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
                onClickCallback(cell.dataset.dateKey, month, day);
            }
        });

        cellsContainer.appendChild(cell);
        calendarCells.push(cell);
    }
}

export function changeMonth(delta) {
    viewDate.setMonth(viewDate.getMonth() + delta);
}

export function buildCalendar(workData) {
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const today = new Date();

    document.getElementById('currentDate').textContent = `${currentYear}년 ${currentMonth + 1}월`;

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();

    let monthTotalWork = 0;
    let monthTotalFare = 0;
    let monthTotalPalletFare = 0;
    let monthTotalMaintFare = 0;

    const savedSettings = loadSettingsData();
    const fixedUnitPrice = parseCurrencyValue(savedSettings.unitPrice);
    const palletUnitPrice = parseCurrencyValue(savedSettings.palletPrice);

    for (let i = 0; i < calendarCells.length; i++) {
        const cell = calendarCells[i];
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

            if (record === 'off') {
                const badge = document.createElement('span');
                badge.classList.add('off-badge');
                badge.textContent = `휴무`;
                cell.appendChild(badge);
            } else if (record && typeof record === 'object') {
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
                if (record.palletCount > 0 && savedSettings.fixedOn && savedSettings.palletOn) {
                    dayPalletFare += record.palletCount * palletUnitPrice;
                    monthTotalPalletFare += dayPalletFare;
                }
                if (record.callFares && record.callFares.length > 0) {
                    dayWorkCount += record.callFares.length;
                    const callSum = record.callFares.reduce((a, b) => a + parseCurrencyValue(b), 0);
                    dayFare += callSum;
                }

                if (dayWorkCount > 0) {
                    monthTotalWork += dayWorkCount;
                    monthTotalFare += dayFare;

                    const badge = document.createElement('span');
                    badge.classList.add('work-badge');
                    badge.textContent = `${dayWorkCount}회`;
                    cell.appendChild(badge);
                } else if (dayPalletFare > 0) {
                    monthTotalPalletFare += dayPalletFare;
                }

                if (record.maintItems && record.maintItems.length > 0) {
                    const maintSum = record.maintItems.reduce((a, b) => a + parseCurrencyValue(b.fare), 0);
                    if (maintSum > 0) {
                        monthTotalMaintFare += maintSum;
                        const maintBadge = document.createElement('span');
                        maintBadge.classList.add('maint-badge');
                        maintBadge.textContent = `${maintSum.toLocaleString()}원`;
                        cell.appendChild(maintBadge);
                    }
                }
            }
        } else {
            cell.classList.add('empty');
        }
    }

    updateSummary(monthTotalWork, monthTotalFare, monthTotalPalletFare, monthTotalMaintFare);
}

function updateSummary(totalCount, fareTotal, palletTotal, maintTotal) {
    const vat = Math.round((fareTotal + palletTotal) * 0.1);
    const grandTotal = fareTotal + palletTotal + vat;

    document.getElementById('summaryTotalWork').textContent = `총 ${totalCount}회 운행`;
    document.getElementById('summaryFare').textContent = `${fareTotal.toLocaleString()} 원`;

    const savedSettings = loadSettingsData();
    const palletRow = document.getElementById('summaryPalletRow');
    
    if (savedSettings.fixedOn && savedSettings.palletOn && palletTotal > 0) {
        palletRow.style.display = 'flex';
        document.getElementById('summaryPalletFare').textContent = `${palletTotal.toLocaleString()} 원`;
    } else {
        palletRow.style.display = 'none';
    }

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