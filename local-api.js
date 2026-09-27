(() => {
  const request = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.code = `http_${response.status}`; throw error; }
    return response.json();
  };
  const snapshot = (payload) => ({ exists: payload.exists, data: () => payload.data });
  const doc = (docPath) => ({
    get: async () => snapshot(await request(`/api/doc?path=${encodeURIComponent(docPath)}`)),
    set: async (data) => request(`/api/doc?path=${encodeURIComponent(docPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }),
    update: async (data) => request(`/api/doc?path=${encodeURIComponent(docPath)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }),
    delete: async () => request(`/api/doc?path=${encodeURIComponent(docPath)}`, { method: 'DELETE' }),
    collection: (name) => collection(`${docPath}/${name}`),
    onSnapshot(success, failure) { let previous = ''; let active = true; const poll = async () => { try { const data = await request(`/api/doc?path=${encodeURIComponent(docPath)}`); const next = JSON.stringify(data); if (next !== previous) { previous = next; success(snapshot(data)); } } catch (error) { failure?.(error); } }; poll(); const timer = setInterval(() => { if (active) poll(); }, 1000); return () => { active = false; clearInterval(timer); }; },
  });
  const collection = (collectionPath, order) => ({
    orderBy: (field) => collection(collectionPath, field),
    doc: (id) => doc(`${collectionPath}/${id}`),
    add: async (data) => { const result = await request('/api/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: collectionPath, data }) }); return { id: result.id }; },
    onSnapshot(success, failure) { let previous = ''; let active = true; const poll = async () => { try { const result = await request(`/api/collection?path=${encodeURIComponent(collectionPath)}`); const rows = order ? result.docs.sort((a, b) => (a.data[order] ?? 0) - (b.data[order] ?? 0)) : result.docs; const next = JSON.stringify(rows); if (next !== previous) { previous = next; success({ docs: rows.map((row) => ({ id: row.id, data: () => row.data })) }); } } catch (error) { failure?.(error); } }; poll(); const timer = setInterval(() => { if (active) poll(); }, 1000); return () => { active = false; clearInterval(timer); }; },
  });
  const uid = (() => { let id = localStorage.getItem('sg_local_uid'); if (!id) { id = `u${crypto.randomUUID().replace(/-/g, '')}`; localStorage.setItem('sg_local_uid', id); } return id; })();
  const user = {
    can: () => true,
    id: async () => uid,
    name: async () => localStorage.getItem('sg_local_name') || 'ローカルユーザー',
    profiles: async (ids) => Object.fromEntries(ids.map((id) => [id, { name: id === uid ? (localStorage.getItem('sg_local_name') || 'ローカルユーザー') : 'ローカル参加者' }])),
  };
  const assets = { upload: async (file) => request('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file }) };
  window.shinobigamiLocal = { use: async (name) => ({ db: { doc, collection }, user, assets })[name] || null };
})();
