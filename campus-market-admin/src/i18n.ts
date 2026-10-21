import polyglotI18nProvider from 'ra-i18n-polyglot';
import english from 'ra-language-english';
import chinese from 'ra-language-chinese';

// 中文语言包沿用上游开源翻译，新增键由官方英文包补全。
const messages = {
    ...english,
    ...chinese,
    ra: Object.fromEntries(Object.entries(english.ra).map(([key, value]) => [key,
        typeof value === 'object' && value !== null
            ? { ...value, ...(chinese.ra[key] ?? {}) }
            : chinese.ra[key] ?? value,
    ])) as typeof english.ra,
};
messages.ra.page.dashboard = '运营工作台';
messages.ra.message.access_denied = '此账号没有访问该页面的权限。';
messages.ra.action.select_columns = '显示列';
messages.ra.action.search_columns = '搜索列';
export const i18nProvider = polyglotI18nProvider(() => messages, 'zh', { allowMissing: true });
