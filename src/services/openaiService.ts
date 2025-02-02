import {Message} from '../types/chat';
import { ClientError, ServerError } from '../types/error';

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const API_URL = import.meta.env.VITE_OPENAI_BASE_URL + '/chat/completions';
const MODEL_NAME = import.meta.env.VITE_OPENAI_MODEL_NAME;

// 配置常量
const MAX_RETRIES = 5;
const BASE_DELAY = 1000;
const MAX_DELAY = 10000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const CLIENT_ERROR_CODES = new Set([400, 401, 403, 404]);

// 智能退避算法（含抖动）
const calculateDelay = (attempt: number, retryAfter?: string) => {
    // 优先使用API返回的Retry-After
    if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        return isNaN(parsed) ? BASE_DELAY : parsed * 1000;
    }

    // 指数退避 + 随机抖动
    const jitter = Math.random() * 500;
    const delay = Math.min(
        BASE_DELAY * Math.pow(2, attempt) + jitter,
        MAX_DELAY
    );

    return delay;
};

// 错误类型检测
const isNetworkError = (error: Error) =>
    error.message.includes('Failed to fetch') ||
    error.message.includes('ECONNRESET');

export const fetchChatResponse = async (messages: Message[]) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    messages: messages,
                    stream: true,
                }),
            });

            if (response.ok) return response.body;

            // 处理客户端错误
            if (CLIENT_ERROR_CODES.has(response.status)) {
                const errorMessage = await response.text();
                throw new ClientError(response.status, errorMessage);
            }

            // 处理服务端错误
            if (!RETRYABLE_STATUS_CODES.has(response.status)) {
                const errorMessage = await response.text();
                throw new ServerError(response.status, errorMessage);
            }

            // 获取服务端建议的等待时间
            const retryAfter = response.headers.get('Retry-After');
            lastError = new Error(`Retryable error (${response.status})`);
            const delay = calculateDelay(attempt, retryAfter || undefined);

            console.warn(
                `Attempt ${attempt + 1} failed with status ${response.status}, retrying in ${delay}ms...`
            );
            await wait(delay);

        } catch (error) {
            lastError = error as Error;

            // 网络错误处理
            if (isNetworkError(lastError)) {
                console.warn(`Network error detected, retrying in ${calculateDelay(attempt)}ms...`);
                continue;
            }

            // 客户端错误处理
            if (lastError instanceof ClientError) {
                console.error(
                    `Client error (${lastError.statusCode}): ${lastError.message}`
                );
                throw lastError;
            }

            // 服务端错误处理
            if (lastError instanceof ServerError) {
                console.error(
                    `Server error (${lastError.statusCode}): ${lastError.message}`
                );
                throw lastError;
            }

            // 其他未知错误处理
            console.error(`Unknown error occurred: ${lastError.message}`);
            if (attempt === MAX_RETRIES - 1) break;
            await wait(calculateDelay(attempt));
        }
    }

    console.error(`API request failed after ${MAX_RETRIES} attempts`);
    throw lastError || new Error('Unknown API error');
};

// 独立封装的等待函数
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));