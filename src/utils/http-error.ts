import { isAxiosError } from 'axios';

export interface ToolErrorInfo {
  status?: number;
  message: string;
}

export const parseHttpError = (error: unknown): ToolErrorInfo => {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const detail = typeof error.response?.data === 'string'
      ? error.response?.data
      : JSON.stringify(error.response?.data ?? {});
    const message = error.message || 'HTTP request failed';
    if (status) {
      return {
        status,
        message: `${message} (status ${status}) - ${detail}`,
      };
    }
    return { message };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: 'Unknown error' };
};
