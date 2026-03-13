export namespace Moodle {
  export type User = {
    email?: string;
    fullname?: string;
    id: number;
    idnumber?: string;
    roles?: { shortname?: string }[];
    username?: string;
  };

  export function identify({ email, fullname, id, idnumber, username }: User) {
    return username || email || idnumber || fullname || `${id}`;
  }

  export function request(url: string, token: string) {
    const endpoint = `${url}/webservice/rest/server.php`;
    return async function request<T>(action: string, params = ''): Promise<T> {
      const body = new URLSearchParams(params);
      body.set('wstoken', token);
      body.set('wsfunction', action);
      body.set('moodlewsrestformat', 'json');

      const response = await fetch(endpoint, { method: 'POST', body });
      if (!response.ok)
        throw new Error(`${action} failed (status ${response.status})`);

      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'exception' in payload)
        throw new Error((payload.message as string) || `${action} failed`);
      return payload as T;
    };
  }
}
