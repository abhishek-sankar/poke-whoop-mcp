import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

import { TokenStore } from '../auth/token-store.js';
import { WhoopOAuthClient } from '../auth/whoop-oauth.js';
import { PaginatedQueryParams, PaginatedSleepResponse, RecoveryCollection, Recovery, Sleep, UserBasicProfile, UserBodyMeasurement, Workout, WorkoutCollection, PaginatedCycleResponse, Cycle } from './types.js';

const WHOOP_API_BASE_URL = 'https://api.prod.whoop.com/developer';

export class WhoopApiClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly oauthClient: WhoopOAuthClient,
  ) {
    this.http = axios.create({
      baseURL: WHOOP_API_BASE_URL,
    });
  }

  private async getAccessToken(key = 'default'): Promise<string> {
    const token = await this.tokenStore.get(key);
    if (!token) {
      throw new Error('No WHOOP token available. Complete the OAuth flow first.');
    }

    if (token.expiresAt <= Date.now()) {
      const refreshed = await this.oauthClient.refreshToken(key);
      return refreshed.accessToken;
    }

    return token.accessToken;
  }

  private async request<T>(config: AxiosRequestConfig, key = 'default'): Promise<T> {
    const accessToken = await this.getAccessToken(key);
    const response = await this.http.request<T>({
      ...config,
      headers: {
        ...(config.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.data;
  }

  async getBasicProfile(key = 'default'): Promise<UserBasicProfile> {
    return this.request<UserBasicProfile>({
      method: 'GET',
      url: '/v2/user/profile/basic',
    }, key);
  }

  async getBodyMeasurements(key = 'default'): Promise<UserBodyMeasurement> {
    return this.request<UserBodyMeasurement>({
      method: 'GET',
      url: '/v2/user/measurement/body',
    }, key);
  }

  async listSleep(params: PaginatedQueryParams = {}, key = 'default'): Promise<PaginatedSleepResponse> {
    return this.request<PaginatedSleepResponse>({
      method: 'GET',
      url: '/v2/activity/sleep',
      params: this.normalizePaginatedParams(params),
    }, key);
  }

  async getSleepById(id: string, key = 'default'): Promise<Sleep> {
    return this.request<Sleep>({
      method: 'GET',
      url: `/v2/activity/sleep/${id}`,
    }, key);
  }

  async listRecoveries(params: PaginatedQueryParams = {}, key = 'default'): Promise<RecoveryCollection> {
    return this.request<RecoveryCollection>({
      method: 'GET',
      url: '/v2/recovery',
      params: this.normalizePaginatedParams(params),
    }, key);
  }

  async getRecoveryForCycle(cycleId: number, key = 'default'): Promise<Recovery> {
    return this.request<Recovery>({
      method: 'GET',
      url: `/v2/cycle/${cycleId}/recovery`,
    }, key);
  }

  async listWorkouts(params: PaginatedQueryParams = {}, key = 'default'): Promise<WorkoutCollection> {
    return this.request<WorkoutCollection>({
      method: 'GET',
      url: '/v2/activity/workout',
      params: this.normalizePaginatedParams(params),
    }, key);
  }

  async getWorkoutById(id: string, key = 'default'): Promise<Workout> {
    return this.request<Workout>({
      method: 'GET',
      url: `/v2/activity/workout/${id}`,
    }, key);
  }

  async listCycles(params: PaginatedQueryParams = {}, key = 'default'): Promise<PaginatedCycleResponse> {
    return this.request<PaginatedCycleResponse>({
      method: 'GET',
      url: '/v2/cycle',
      params: this.normalizePaginatedParams(params),
    }, key);
  }

  async getCycleById(id: number, key = 'default'): Promise<Cycle> {
    return this.request<Cycle>({
      method: 'GET',
      url: `/v2/cycle/${id}`,
    }, key);
  }

  async getSleepForCycle(cycleId: number, key = 'default'): Promise<Sleep> {
    return this.request<Sleep>({
      method: 'GET',
      url: `/v2/cycle/${cycleId}/sleep`,
    }, key);
  }

  private normalizePaginatedParams(params: PaginatedQueryParams) {
    return {
      limit: params.limit,
      start: params.start,
      end: params.end,
      nextToken: params.nextToken,
    };
  }
}
