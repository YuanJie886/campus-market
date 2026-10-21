import queryString from '@campus/query-string-upstream';
// react-admin 5 同时使用默认导出和旧版具名导出；在已修复的 query-string 9 上保留该接口。
export const { parse, stringify, parseUrl, stringifyUrl, extract, pick, exclude } = queryString;
export default queryString;
