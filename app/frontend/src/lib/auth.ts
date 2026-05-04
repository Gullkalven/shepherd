import axios, { AxiosInstance } from 'axios';
import { getAPIBaseURL } from './config';
import { invalidateClientSession, logoutRemoteSession } from './appLogout';

class RPApi {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private getBaseURL() {
    return getAPIBaseURL();
  }

  async getCurrentUser() {
    try {
      const response = await this.client.get(
        `${this.getBaseURL()}/api/v1/auth/me`
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        return null;
      }
      throw new Error(
        error.response?.data?.detail || 'Failed to get user info'
      );
    }
  }

  async login() {
    try {
      const response = await this.client.get(
        `${this.getBaseURL()}/api/v1/auth/login`
      );
      // The backend will redirect to OIDC provider
      // SSO will work via cookies automatically
      window.location.href = response.data.redirect_url;
    } catch (error) {
      throw new Error(
        error.response?.data?.detail || 'Failed to initiate login'
      );
    }
  }

  /**
   * Best-effort POST to `/auth/logout`, then clear client session (no GET, no `redirect_url`).
   * Does not throw — callers should clear local UI state (e.g. `setUser(null)`).
   */
  async logout(): Promise<void> {
    await logoutRemoteSession();
    invalidateClientSession();
  }
}

export const authApi = new RPApi();
