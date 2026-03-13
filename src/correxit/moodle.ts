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

  export async function upload(
    url: string,
    token: string,
    content: string,
    filename: string
  ): Promise<number | null> {
    const form = new FormData();
    const blob = new Blob([content], { type: 'application/json' });
    form.append('token', token);
    form.append('filearea', 'draft');
    form.append('itemid', '0');
    form.append('file_1', blob, filename);

    const response = await fetch(`${url}/webservice/upload.php`, {
      method: 'POST',
      body: form
    });
    const draft = await response.json();
    if (!Array.isArray(draft) || !draft[0]?.itemid) return null;
    return draft[0].itemid;
  }
}
