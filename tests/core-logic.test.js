const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

let win;

beforeAll(() => {
    const scriptContent = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf-8');

    // script.js 맨 아래에는 실제 앱 화면(달력 select 등)을 초기화하는 최상위 코드가 있는데,
    // 테스트용 빈 문서에는 그 DOM 엘리먼트들이 없어 여기서 에러가 난다. 이 에러는 무해하다 —
    // 함수 선언은 이미 호이스팅되어 있어서 우리가 테스트할 함수들에는 영향이 없다.
    // 콘솔에 매번 긴 스택트레이스가 찍히는 걸 막기 위해서만 virtualConsole로 조용히 무시한다.
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        runScripts: 'dangerously',
        url: 'http://localhost/',
        virtualConsole
    });
    const scriptEl = dom.window.document.createElement('script');
    scriptEl.textContent = scriptContent;
    dom.window.document.body.appendChild(scriptEl);
    win = dom.window;
});

describe('createNormalizedId(prefix, ...parts)', () => {
    test('같은 입력이면 항상 같은 출력을 낸다 (결정론성)', () => {
        const id1 = win.createNormalizedId('client', '삼성물류', '010-1234-5678');
        const id2 = win.createNormalizedId('client', '삼성물류', '010-1234-5678');
        expect(id1).toBe(id2);
    });

    test('결과 문자열이 "prefix_"로 시작한다', () => {
        const id = win.createNormalizedId('client', '삼성물류');
        expect(id.startsWith('client_')).toBe(true);
    });

    test('prefix가 다르면 접두어도 그에 맞게 다르다', () => {
        const clientId = win.createNormalizedId('client', 'A');
        const carId = win.createNormalizedId('car', 'A');
        expect(clientId.startsWith('client_')).toBe(true);
        expect(carId.startsWith('car_')).toBe(true);
    });

    test('입력(parts)이 다르면 출력도 다르다', () => {
        const id1 = win.createNormalizedId('client', '삼성물류');
        const id2 = win.createNormalizedId('client', '한진택배');
        expect(id1).not.toBe(id2);
    });
});

describe('isDateWithinAssignment(dateKey, assignmentStart, assignmentEnd)', () => {
    test('할당 기간 중간 날짜면 true', () => {
        expect(win.isDateWithinAssignment('2026-05-15', '2026-05-01', '2026-05-31')).toBe(true);
    });

    test('할당 기간 이전 날짜면 false', () => {
        expect(win.isDateWithinAssignment('2026-04-30', '2026-05-01', '2026-05-31')).toBe(false);
    });

    test('할당 기간 이후 날짜면 false', () => {
        expect(win.isDateWithinAssignment('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false);
    });

    test('시작일 경계값은 true', () => {
        expect(win.isDateWithinAssignment('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true);
    });

    test('종료일 경계값은 true', () => {
        expect(win.isDateWithinAssignment('2026-05-31', '2026-05-01', '2026-05-31')).toBe(true);
    });

    test('assignmentStart가 빈 값이면 항상 true (레거시 데이터 보호)', () => {
        expect(win.isDateWithinAssignment('2020-01-01', '', '2026-05-31')).toBe(true);
        expect(win.isDateWithinAssignment('2099-01-01', '', '')).toBe(true);
    });
});

describe('getDetailPaymentSummary(detail)', () => {
    test('payments 없이 paymentStatus: "미수"인 레거시 데이터는 status: "unpaid"', () => {
        const result = win.getDetailPaymentSummary({ fare: '300,000', paymentStatus: '미수' });
        expect(result.status).toBe('unpaid');
        expect(result.paidAmount).toBe(0);
        expect(result.remainingAmount).toBe(300000);
    });

    test('payments 없이 paymentStatus: "수금 완료"인 레거시 데이터는 status: "paid"', () => {
        const result = win.getDetailPaymentSummary({ fare: '300,000', paymentStatus: '수금 완료' });
        expect(result.status).toBe('paid');
        expect(result.paidAmount).toBe(300000);
        expect(result.remainingAmount).toBe(0);
    });

    test('부분 입금이면 status: "partial", 잔액이 정확히 계산된다', () => {
        const result = win.getDetailPaymentSummary({ fare: 300000, payments: [{ amount: 100000 }] });
        expect(result.status).toBe('partial');
        expect(result.paidAmount).toBe(100000);
        expect(result.remainingAmount).toBe(200000);
    });

    test('전액 입금이면 status: "paid", remainingAmount: 0', () => {
        const result = win.getDetailPaymentSummary({ fare: 300000, payments: [{ amount: 300000 }] });
        expect(result.status).toBe('paid');
        expect(result.remainingAmount).toBe(0);
    });

    test('여러 건의 부분 입금 합계가 fare를 넘으면 remainingAmount는 0 아래로 내려가지 않는다', () => {
        const result = win.getDetailPaymentSummary({ fare: 300000, payments: [{ amount: 200000 }, { amount: 200000 }] });
        expect(result.status).toBe('paid');
        expect(result.remainingAmount).toBe(0);
        expect(result.paidAmount).toBe(400000);
    });
});

describe('parseCurrencyValue(str)', () => {
    test('"250,000" → 250000', () => {
        expect(win.parseCurrencyValue('250,000')).toBe(250000);
    });

    test('빈 문자열은 0', () => {
        expect(win.parseCurrencyValue('')).toBe(0);
    });

    test('null은 0', () => {
        expect(win.parseCurrencyValue(null)).toBe(0);
    });

    test('undefined는 0', () => {
        expect(win.parseCurrencyValue(undefined)).toBe(0);
    });

    test('숫자 타입 입력도 그대로 처리한다', () => {
        expect(win.parseCurrencyValue(250000)).toBe(250000);
    });

    test('숫자가 아닌 문자만 있으면 0', () => {
        expect(win.parseCurrencyValue('원')).toBe(0);
    });
});

describe('escapeDetailText(value)', () => {
    test('"<"는 "&lt;"로 이스케이프된다', () => {
        expect(win.escapeDetailText('<')).toBe('&lt;');
    });

    test('">"는 "&gt;"로 이스케이프된다', () => {
        expect(win.escapeDetailText('>')).toBe('&gt;');
    });

    test('"&"는 "&amp;"로 이스케이프된다', () => {
        expect(win.escapeDetailText('&')).toBe('&amp;');
    });

    test('\'"\'는 "&quot;"로 이스케이프된다', () => {
        expect(win.escapeDetailText('"')).toBe('&quot;');
    });

    test("\"'\"는 \"&#39;\"로 이스케이프된다", () => {
        expect(win.escapeDetailText("'")).toBe('&#39;');
    });

    test('<script> 문자열이 포함된 텍스트가 안전하게 변환된다', () => {
        const result = win.escapeDetailText('<script>alert("xss")</script>');
        expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(result).not.toContain('<script>');
    });
});

describe('getEffectiveDriverSettlementMode(car, settings)', () => {
    // 내부 로직(script.js): selected = car?.settlementMode || 'default';
    // selected === 'default' 이면 settings.defaultDriverSettlementMode || 'company' 를 반환하고,
    // 아니면 car에 명시된 값을 그대로 반환한다.

    test('car.settlementMode가 명시된 값이면 settings와 무관하게 그 값을 그대로 반환한다', () => {
        const car = { settlementMode: 'driver_direct' };
        const settings = { defaultDriverSettlementMode: 'employee' };
        expect(win.getEffectiveDriverSettlementMode(car, settings)).toBe('driver_direct');
    });

    test('car.settlementMode가 "default"이면 settings.defaultDriverSettlementMode를 따른다', () => {
        const car = { settlementMode: 'default' };
        const settings = { defaultDriverSettlementMode: 'employee' };
        expect(win.getEffectiveDriverSettlementMode(car, settings)).toBe('employee');
    });

    test('car.settlementMode가 "default"이고 settings에도 값이 없으면 "company"로 폴백한다', () => {
        const car = { settlementMode: 'default' };
        const settings = {};
        expect(win.getEffectiveDriverSettlementMode(car, settings)).toBe('company');
    });

    test('car.settlementMode 필드 자체가 없으면 "default"와 동일하게 동작한다', () => {
        const car = {};
        const settings = { defaultDriverSettlementMode: 'none' };
        expect(win.getEffectiveDriverSettlementMode(car, settings)).toBe('none');
    });

    test('car가 null/undefined여도 settings의 기본값으로 안전하게 폴백한다', () => {
        const settings = { defaultDriverSettlementMode: 'employee' };
        expect(win.getEffectiveDriverSettlementMode(null, settings)).toBe('employee');
        expect(win.getEffectiveDriverSettlementMode(undefined, {})).toBe('company');
    });
});
