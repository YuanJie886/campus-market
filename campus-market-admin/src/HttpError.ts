/** 与 react-admin 的错误契约一致：message、status、body，不触发整个 UI 包的加载。 */
export class HttpError extends Error {
    constructor(message: string, public status: number, public body?: unknown) {
        super(message);
        this.name = 'HttpError';
    }
}
