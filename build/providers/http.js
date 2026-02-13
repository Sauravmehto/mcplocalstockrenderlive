export class ProviderError extends Error {
    provider;
    code;
    status;
    constructor(provider, code, message, status) {
        super(message);
        this.provider = provider;
        this.code = code;
        this.status = status;
    }
}
function mapStatusToCode(status) {
    if (status === 401 || status === 403) {
        return "AUTH";
    }
    if (status === 404) {
        return "NOT_FOUND";
    }
    if (status === 429) {
        return "RATE_LIMIT";
    }
    return "UPSTREAM";
}
export async function fetchJson(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
        const response = await fetch(url, {
            headers: options.headers,
            signal: controller.signal,
        });
        const raw = await response.text();
        let parsed = {};
        if (raw) {
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                throw new ProviderError(options.provider, "BAD_RESPONSE", "Provider returned non-JSON content.", response.status);
            }
        }
        if (!response.ok) {
            throw new ProviderError(options.provider, mapStatusToCode(response.status), `Provider request failed with status ${response.status}.`, response.status);
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof ProviderError) {
            throw error;
        }
        throw new ProviderError(options.provider, "NETWORK", `Provider request failed: ${error.message}`);
    }
    finally {
        clearTimeout(timeout);
    }
}
