export function loadWorkData() {
    return JSON.parse(localStorage.getItem('workData')) || {};
}

export function saveWorkData(data) {
    localStorage.setItem('workData', JSON.stringify(data));
}

export function loadSettingsData() {
    return JSON.parse(localStorage.getItem('userSettings')) || {
        buttonValues: [1, 2, 3],
        btnCount: 3
    };
}

export function saveSettingsData(settings) {
    localStorage.setItem('userSettings', JSON.stringify(settings));
}

export function loadTheme() {
    return localStorage.getItem('theme') || 'light';
}

export function saveTheme(theme) {
    localStorage.setItem('theme', theme);
}