(() => {
  const PETS_KEY = 'guardianQrPublishedPets';
  const REQUESTS_KEY = 'guardianQrPublicationRequests';
  const OWNERS_KEY = 'guardianQrOwners';
  const CONTACT_KEY = 'guardianQrContact';
  const COVER_KEY = 'nubivetPublicCover';
  const PET_SIZE_LABELS = { small: 'Pequeña', medium: 'Mediana', large: 'Grande' };
  const dataCache = { [PETS_KEY]: [], [REQUESTS_KEY]: [], [OWNERS_KEY]: [] };
  let client = null;
  let isLocalMode = false;
  let publicContactNumber = '';
  let publicCoverPath = '';
  let publicCoverImage = '';

  const getPetSize = (pet) => pet.size || (/gato|cat/i.test(pet.species || '') ? 'small' : 'medium');
  const getPetSizeLabel = (pet) => PET_SIZE_LABELS[getPetSize(pet)] || 'Mediana';
  const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '');
  const getOwnerGroupKey = (owner) => normalizePhone(owner.phone) || String(owner.email || owner.id || owner.name || '').trim().toLowerCase();
  const hasCloudConfiguration = () => Boolean(window.NUBIVET_CONFIG?.supabaseUrl && window.NUBIVET_CONFIG?.supabaseAnonKey);
  const hasPartialCloudConfiguration = () => Boolean(window.NUBIVET_CONFIG?.supabaseUrl || window.NUBIVET_CONFIG?.supabaseAnonKey);
  const getStoredItems = (key) => dataCache[key] || [];
  const saveStoredItems = (key, items) => {
    dataCache[key] = items;
    if (isLocalMode) localStorage.setItem(key, JSON.stringify(items));
  };

  const loadLocalData = () => {
    isLocalMode = true;
    [PETS_KEY, REQUESTS_KEY, OWNERS_KEY].forEach((key) => {
      try {
        dataCache[key] = JSON.parse(localStorage.getItem(key) || '[]');
      } catch (error) {
        console.error(`No se pudieron leer los datos locales de ${key}.`, error);
        dataCache[key] = [];
      }
    });
    dataCache[REQUESTS_KEY] = dataCache[REQUESTS_KEY].map((request) => ({
      id: request.id || crypto.randomUUID(),
      createdAt: request.createdAt || new Date().toISOString(),
      status: request.status || 'pending',
      ...request
    }));
    publicContactNumber = localStorage.getItem(CONTACT_KEY) || '+591 700 00000';
    publicCoverImage = localStorage.getItem(COVER_KEY) || '';
    setConnectionNotice('Modo demostración: la información se guarda solo en este navegador y no se sincroniza con Supabase.', false);
  };

  const setConnectionNotice = (message, isError = true) => {
    let notice = document.querySelector('[data-cloud-notice]');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'cloud-notice';
      notice.dataset.cloudNotice = '';
      document.body.prepend(notice);
    }
    notice.textContent = message;
    notice.classList.toggle('error', isError);
    notice.hidden = !message;
  };

  const throwIfCloudError = (error) => {
    if (error) throw new Error(error.message || 'Ocurrió un error al comunicarse con Supabase.');
  };

  const getPhotoUrl = (path) => {
    if (!path || !client) return '';
    return client.storage.from('pet-photos').getPublicUrl(path).data.publicUrl;
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error || new Error('No se pudo leer la imagen.')));
    reader.readAsDataURL(file);
  });

  const createLocalPhoto = async (file) => {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo procesar la imagen.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.78);
  };

  const mapPet = (row) => {
    const hasPrivateHealthFields = Object.prototype.hasOwnProperty.call(row, 'diseases');
    return {
      id: row.pet_id || row.id,
      ownerId: row.owner_id,
      name: row.name,
      species: row.species,
      breed: row.breed,
      size: row.size,
      sex: row.sex,
      temperament: row.temperament,
      lastSeen: row.last_seen_place,
      status: row.status,
      photoPath: row.photo_path,
      photo: getPhotoUrl(row.photo_path),
      diseases: hasPrivateHealthFields ? row.diseases : row.public_diseases,
      publicDiseases: Boolean(row.public_diseases),
      heartProblems: hasPrivateHealthFields ? row.heart_problems : row.public_heart_problems,
      publicHeartProblems: Boolean(row.public_heart_problems),
      allergies: hasPrivateHealthFields ? row.allergies : row.public_allergies,
      publicAllergies: Boolean(row.public_allergies),
      medications: row.medications,
      vaccines: row.vaccines,
      clinicalHistory: row.clinical_history,
      publicToken: row.public_token
    };
  };

  const mapOwner = (row) => ({
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    email: row.email,
    address: row.address_label,
    locationLink: row.location_url
  });

  const mapRequest = (row) => ({
    id: row.id,
    owner: row.owner_name,
    phone: row.owner_phone,
    petName: row.pet_name,
    lastSeen: row.last_seen_place,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  });

  const loadPublicData = async () => {
    const [petsResult, settingsResult] = await Promise.all([
      client.from('public_pet_profiles').select('*').order('name'),
      client.from('app_settings').select('setting_key, setting_value').in('setting_key', ['public_contact_phone', 'public_cover_photo_path'])
    ]);
    throwIfCloudError(petsResult.error);
    throwIfCloudError(settingsResult.error);
    saveStoredItems(PETS_KEY, (petsResult.data || []).map(mapPet));
    const settings = new Map((settingsResult.data || []).map((setting) => [setting.setting_key, setting.setting_value]));
    publicContactNumber = settings.get('public_contact_phone') || '';
    publicCoverPath = settings.get('public_cover_photo_path') || '';
    publicCoverImage = getPhotoUrl(publicCoverPath);
  };

  const loadAdminData = async () => {
    const [petsResult, ownersResult, requestsResult, settingsResult] = await Promise.all([
      client.from('pets').select('*').order('created_at', { ascending: false }),
      client.from('owners').select('*').order('created_at', { ascending: false }),
      client.from('publication_requests').select('*').order('created_at', { ascending: false }),
      client.from('app_settings').select('setting_key, setting_value').in('setting_key', ['public_contact_phone', 'public_cover_photo_path'])
    ]);
    [petsResult, ownersResult, requestsResult, settingsResult].forEach((result) => throwIfCloudError(result.error));
    const owners = (ownersResult.data || []).map(mapOwner);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    const pets = (petsResult.data || []).map((row) => {
      const pet = mapPet(row);
      const owner = ownerById.get(pet.ownerId);
      return owner ? {
        ...pet,
        ownerName: owner.name,
        ownerPhone: owner.phone,
        ownerEmail: owner.email,
        ownerAddress: owner.address,
        ownerLocationLink: owner.locationLink
      } : pet;
    });
    saveStoredItems(PETS_KEY, pets);
    saveStoredItems(OWNERS_KEY, owners);
    saveStoredItems(REQUESTS_KEY, (requestsResult.data || []).map(mapRequest));
    const settings = new Map((settingsResult.data || []).map((setting) => [setting.setting_key, setting.setting_value]));
    publicContactNumber = settings.get('public_contact_phone') || '';
    publicCoverPath = settings.get('public_cover_photo_path') || '';
    publicCoverImage = getPhotoUrl(publicCoverPath);
  };

  const isCurrentUserAdmin = async () => {
    const { data: { user }, error: sessionError } = await client.auth.getUser();
    throwIfCloudError(sessionError);
    if (!user) return false;
    const { data, error } = await client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
    throwIfCloudError(error);
    return Boolean(data);
  };

  const initializeCloud = async () => {
    const loadScript = (src) => new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find((script) => script.src === new URL(src, window.location.href).href);
      if (existing?.dataset.loaded === 'true') return resolve();
      const script = existing || document.createElement('script');
      script.src = src;
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
      if (!existing) document.head.appendChild(script);
    });
    if (!window.NUBIVET_CONFIG) {
      try {
        await loadScript('supabase-config.js');
      } catch (error) {
        console.warn(`${error.message}; se habilitará el modo demostración local.`);
        loadLocalData();
        return isPanelSessionValid();
      }
    }
    if (!hasCloudConfiguration()) {
      if (hasPartialCloudConfiguration()) {
        setConnectionNotice('Completa el Project URL y la clave pública de Supabase en supabase-config.js.');
        return false;
      }
      loadLocalData();
      return isPanelSessionValid();
    }
    if (!window.supabase?.createClient) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      } catch (error) {
        setConnectionNotice(`No se pudo cargar Supabase: ${error.message}. Revisa tu conexión e inténtalo de nuevo.`);
        return false;
      }
    }
    if (!window.supabase?.createClient) {
      setConnectionNotice('No se pudo iniciar el cliente de Supabase. Revisa la conexión e inténtalo de nuevo.');
      return false;
    }
    client = window.supabase.createClient(window.NUBIVET_CONFIG.supabaseUrl, window.NUBIVET_CONFIG.supabaseAnonKey);
    try {
      await loadPublicData();
      if (document.body.dataset.page === 'panel' && await isCurrentUserAdmin()) {
        await loadAdminData();
        return true;
      }
      if (document.body.dataset.page === 'panel') {
        window.location.replace('login.html?next=panel.html');
        return false;
      }
      return true;
    } catch (error) {
      console.error('No se pudo conectar con Supabase.', error);
      client = null;
      setConnectionNotice(`No se pudo conectar con Supabase: ${error.message}. Los datos no se guardarán localmente.`);
      return false;
    }
  };

  const isPanelSessionValid = () => {
    if (document.body.dataset.page !== 'panel') return true;
    window.location.replace('login.html?next=panel.html');
    return false;
  };

  const setupBranding = () => {
    document.querySelectorAll('.brand').forEach((brand) => {
      brand.setAttribute('aria-label', 'Nubivet');
      brand.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">pets</span><span class="brand-name"><span>NUBI</span><span>VET</span></span>';
    });
    const textNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (textNodes.nextNode()) {
      textNodes.currentNode.textContent = textNodes.currentNode.textContent.replace(/Guardian QR/gi, 'Nubivet');
    }
    document.title = document.title.replace(/Guardian QR/gi, 'Nubivet');
    const dashboardIntro = document.querySelector('[data-admin-panel="resumen"] .dashboard-header .muted');
    if (dashboardIntro) dashboardIntro.textContent = 'Indicadores y solicitudes guardados en la base de datos.';
    document.querySelectorAll('[data-admin-panel="resumen"] .stats .stat strong').forEach((stat) => { stat.textContent = '0'; });
  };

  const showToast = (message) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
  };

  const setupLogin = () => {
    const form = document.querySelector('#login-form');
    if (!form) return;
    const email = document.querySelector('#access-email');
    const password = document.querySelector('#access-key');
    const error = document.querySelector('#login-error');
    const next = 'panel.html';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      if (!client) {
        error.textContent = 'Configura Supabase para habilitar el acceso de administración.';
        return;
      }
      const { error: signInError } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (signInError) {
        error.textContent = 'No se pudo iniciar sesión. Verifica tu correo y contraseña.';
        password.select();
        return;
      }
      if (!await isCurrentUserAdmin()) {
        await client.auth.signOut();
        error.textContent = 'Esta cuenta no tiene permisos de administración.';
        return;
      }
      window.location.href = next;
    });
    document.querySelector('[data-cancel-login]')?.addEventListener('click', () => { window.location.href = 'index.html'; });
  };

  const setupLogout = () => {
    document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', async (event) => {
      event.preventDefault();
      if (client) await client.auth.signOut();
      window.location.href = 'index.html';
    }));
  };

  const setupReportForm = () => {
    const form = document.querySelector('#lost-pet-form, #public-report-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      try {
        if (isLocalMode) {
          const requests = getStoredItems(REQUESTS_KEY);
          requests.unshift({
            id: crypto.randomUUID(),
            owner: document.querySelector('#public-owner')?.value.trim() || '',
            phone: document.querySelector('#public-phone')?.value.trim() || '',
            status: 'pending',
            createdAt: new Date().toISOString()
          });
          saveStoredItems(REQUESTS_KEY, requests);
          form.reset();
          renderAdminRequests();
          renderRequestCount();
          showToast('Solicitud guardada en este navegador para la demostración.');
          return;
        }
        if (!client) throw new Error('No hay una conexión activa para guardar la solicitud.');
        const { error } = await client.from('publication_requests').insert({
          owner_name: document.querySelector('#public-owner')?.value.trim(),
          owner_phone: document.querySelector('#public-phone')?.value.trim()
        });
        throwIfCloudError(error);
        form.reset();
        renderRequestCount();
        showToast('Solicitud enviada. Te contactaremos por WhatsApp.');
      } catch (error) {
        console.error('No se pudo enviar la solicitud.', error);
        showToast(`No se pudo enviar la solicitud: ${error.message}`);
      } finally {
        if (button) button.disabled = false;
      }
    });
    document.querySelectorAll('[data-file-label]').forEach((input) => input.addEventListener('change', () => {
      const label = document.querySelector(`[data-label-for="${input.id}"]`);
      if (label && input.files[0]) label.textContent = input.files[0].name;
    }));
  };

  const renderRequestCount = () => {
    const target = document.querySelector('[data-request-count]');
    const requests = getStoredItems(REQUESTS_KEY);
    if (target) target.textContent = requests.filter((request) => (request.status || 'pending') === 'pending').length;
  };

  const renderAdminRequests = () => {
    const container = document.querySelector('[data-request-list]');
    if (!container) return;
    const requests = getStoredItems(REQUESTS_KEY);
    container.innerHTML = '';
    if (!requests.length) {
      container.innerHTML = '<p class="muted empty-state">No hay solicitudes todavía.</p>';
      return;
    }
    requests.forEach((request) => {
      const status = request.status || 'pending';
      const item = document.createElement('article');
      item.className = 'request-item';
      const contact = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = request.owner || 'Sin nombre';
      const metadata = document.createElement('p');
      metadata.textContent = `${request.phone || 'Sin teléfono'} · ${new Date(request.createdAt).toLocaleDateString('es-BO')}`;
      contact.append(name, metadata);
      const statusBadge = document.createElement('span');
      statusBadge.className = `request-status ${status}`;
      statusBadge.textContent = status === 'pending' ? 'Pendiente' : status === 'approved' ? 'Aceptada' : 'Rechazada';
      item.append(contact, statusBadge);
      if (status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'request-actions';
        [['approve', 'Aceptar', 'btn-primary'], ['reject', 'Rechazar', 'btn-danger']].forEach(([action, label, style]) => {
          const button = document.createElement('button');
          button.className = `btn ${style} btn-small`;
          button.type = 'button';
          button.dataset.requestAction = action;
          button.dataset.requestId = request.id;
          button.textContent = label;
          actions.append(button);
        });
        item.append(actions);
      }
      container.appendChild(item);
    });
    container.querySelectorAll('[data-request-action]').forEach((button) => button.addEventListener('click', async () => {
      const request = requests.find((item) => item.id === button.dataset.requestId);
      if (!request) return;
      const status = button.dataset.requestAction === 'approve' ? 'approved' : 'rejected';
      if (isLocalMode) {
        request.status = status;
        request.reviewedAt = new Date().toISOString();
        saveStoredItems(REQUESTS_KEY, requests);
      } else {
        if (!client) return showToast('No hay una conexión activa para actualizar la solicitud.');
        const { data, error } = await client.from('publication_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', request.id).select('*').single();
        if (error) {
          console.error('No se pudo actualizar la solicitud.', error);
          showToast(`No se pudo actualizar: ${error.message}`);
          return;
        }
        Object.assign(request, mapRequest(data));
      }
      renderAdminRequests();
      renderRequestCount();
      if (request.status === 'approved') {
        const ownerInput = document.querySelector('#admin-owner-name');
        const phoneInput = document.querySelector('#admin-owner-phone');
        if (ownerInput) ownerInput.value = request.owner || '';
        if (phoneInput) phoneInput.value = request.phone || '';
        document.querySelector('[data-admin-view="anadir"]')?.click();
        showToast('Solicitud aceptada. Completa los datos de la mascota.');
      } else showToast('Solicitud rechazada.');
    }));
  };

  const setupAdminNavigation = () => {
    const panels = document.querySelectorAll('[data-admin-panel]');
    const buttons = document.querySelectorAll('[data-admin-view]');
    if (!panels.length) return;
    const showView = (view) => {
      panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.adminPanel === view));
      buttons.forEach((button) => button.classList.toggle('active', button.dataset.adminView === view));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    buttons.forEach((button) => button.addEventListener('click', () => showView(button.dataset.adminView)));
    showView('resumen');
  };

  const setupAdminModules = () => {
    const dashboardMain = document.querySelector('.dashboard-main');
    const petListCard = document.querySelector('[data-admin-pet-list]')?.closest('.card');
    const ownersPanel = document.querySelector('[data-admin-panel="duenos"]');
    if (!dashboardMain) return;

    const addNavigationButton = (nav, view, icon, label) => {
      if (!nav || nav.querySelector(`[data-admin-view="${view}"]`)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-nav-button';
      button.dataset.adminView = view;
      button.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>${label}`;
      nav.appendChild(button);
    };

    document.querySelectorAll('.admin-nav, .admin-mobile-nav').forEach((nav) => {
      addNavigationButton(nav, 'mascotas', 'pets', 'Mascotas');
      addNavigationButton(nav, 'portada', 'images', 'Portada');
    });
    document.querySelectorAll('[data-admin-view="duenos"]').forEach((button) => {
      button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">groups</span>Dueños';
    });

    if (!document.querySelector('[data-admin-panel="mascotas"]')) {
      const petPanel = document.createElement('section');
      petPanel.className = 'admin-view';
      petPanel.dataset.adminPanel = 'mascotas';
      petPanel.innerHTML = '<header class="dashboard-header"><div><div class="eyebrow"><span class="material-symbols-outlined" aria-hidden="true">pets</span>Gestión de perfiles</div><h1>Mascotas</h1><p class="muted">Edita los perfiles y cambia su estado con un botón.</p></div><button class="btn btn-primary" type="button" data-admin-view="anadir">Registrar mascota</button></header>';
      if (petListCard) petPanel.appendChild(petListCard);
      else {
        const listCard = document.createElement('div');
        listCard.className = 'card';
        listCard.innerHTML = '<h2>Mascotas registradas</h2><div data-admin-pet-list class="request-list"></div>';
        petPanel.appendChild(listCard);
      }
      dashboardMain.appendChild(petPanel);
    }

    if (ownersPanel && !ownersPanel.querySelector('[data-admin-owner-list]')) {
      const ownersCard = document.createElement('div');
      ownersCard.className = 'card owner-directory';
      const heading = document.createElement('h2');
      heading.textContent = 'Dueños y sus mascotas';
      const list = document.createElement('div');
      list.className = 'request-list';
      list.dataset.adminOwnerList = '';
      ownersCard.append(heading, list);
      ownersPanel.appendChild(ownersCard);
      const title = ownersPanel.querySelector('.dashboard-header h1');
      if (title) title.textContent = 'Dueños';
    }

    if (!document.querySelector('[data-admin-panel="portada"]')) {
      const coverPanel = document.createElement('section');
      coverPanel.className = 'admin-view';
      coverPanel.dataset.adminPanel = 'portada';
      coverPanel.innerHTML = '<header class="dashboard-header"><div><div class="eyebrow"><span class="material-symbols-outlined" aria-hidden="true">images</span>Imagen pública</div><h1>Editar portada</h1><p class="muted">Cambia la imagen principal que aparece al inicio del sitio.</p></div></header><form class="card cover-editor" data-cover-form><label class="form-field" for="cover-image">Nueva imagen de portada <span class="private-note">JPG, PNG o WEBP, hasta 5 MB.</span><input id="cover-image" name="cover" type="file" accept="image/jpeg,image/png,image/webp" required></label><img class="cover-preview" data-cover-preview alt="Vista previa de la portada actual"><div class="cover-actions"><button class="btn btn-secondary" type="button" data-reset-cover>Restaurar imagen original</button><button class="btn btn-primary" type="submit">Guardar portada</button></div></form>';
      dashboardMain.appendChild(coverPanel);
    }

    const sidebarLogout = document.querySelector('.dashboard-sidebar [data-logout]');
    if (sidebarLogout && !document.querySelector('[data-public-exit]')) {
      const exitLink = document.createElement('a');
      exitLink.href = 'index.html';
      exitLink.className = 'admin-nav-button public-exit';
      exitLink.dataset.publicExit = '';
      exitLink.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>Salir al sitio';
      sidebarLogout.after(exitLink);
    }
  };

  const applyPublicCover = () => {
    const image = document.querySelector('.hero-media img');
    if (!image) return;
    if (!image.dataset.defaultSrc) image.dataset.defaultSrc = image.src;
    image.src = publicCoverImage || image.dataset.defaultSrc;
  };

  const setupCoverEditor = () => {
    const form = document.querySelector('[data-cover-form]');
    if (!form) return;
    const fileInput = form.querySelector('#cover-image');
    const preview = form.querySelector('[data-cover-preview]');
    const saveButton = form.querySelector('[type="submit"]');
    let previewUrl = '';

    const showPreview = (src) => {
      if (!preview) return;
      preview.hidden = !src;
      if (src) preview.src = src;
    };
    const releasePreviewUrl = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    };
    showPreview(publicCoverImage);
    fileInput.addEventListener('change', () => {
      releasePreviewUrl();
      const file = fileInput.files?.[0];
      if (file) {
        previewUrl = URL.createObjectURL(file);
        showPreview(previewUrl);
      } else showPreview(publicCoverImage);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = fileInput.files?.[0];
      if (!file) return showToast('Selecciona una imagen para la portada.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880) {
        return showToast('Usa una imagen JPG, PNG o WEBP de hasta 5 MB.');
      }
      saveButton.disabled = true;
      try {
        if (isLocalMode) {
          publicCoverImage = await createLocalPhoto(file);
          localStorage.setItem(COVER_KEY, publicCoverImage);
        } else {
          const { data: { user }, error: userError } = await client.auth.getUser();
          throwIfCloudError(userError);
          if (!user) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.');
          const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
          const path = `${user.id}/covers/${Date.now()}-${safeName}`;
          const { error: uploadError } = await client.storage.from('pet-photos').upload(path, file, { contentType: file.type, upsert: false });
          throwIfCloudError(uploadError);
          const { error: settingError } = await client.from('app_settings').upsert({
            setting_key: 'public_cover_photo_path',
            setting_value: path,
            updated_at: new Date().toISOString()
          });
          throwIfCloudError(settingError);
          publicCoverPath = path;
          publicCoverImage = getPhotoUrl(path);
        }
        releasePreviewUrl();
        showPreview(publicCoverImage);
        applyPublicCover();
        form.reset();
        showToast('Portada actualizada.');
      } catch (error) {
        console.error('No se pudo actualizar la portada.', error);
        showToast(`No se pudo actualizar la portada: ${error.message}`);
      } finally {
        saveButton.disabled = false;
      }
    });

    form.querySelector('[data-reset-cover]').addEventListener('click', async () => {
      const resetButton = form.querySelector('[data-reset-cover]');
      resetButton.disabled = true;
      try {
        if (isLocalMode) {
          localStorage.removeItem(COVER_KEY);
        } else {
          const { error } = await client.from('app_settings').upsert({
            setting_key: 'public_cover_photo_path',
            setting_value: '',
            updated_at: new Date().toISOString()
          });
          throwIfCloudError(error);
        }
        publicCoverPath = '';
        publicCoverImage = '';
        releasePreviewUrl();
        showPreview('');
        applyPublicCover();
        form.reset();
        showToast('Se restauró la portada original.');
      } catch (error) {
        console.error('No se pudo restaurar la portada.', error);
        showToast(`No se pudo restaurar la portada: ${error.message}`);
      } finally {
        resetButton.disabled = false;
      }
    });
  };

  const setupAdminRequestForm = () => {
    const form = document.querySelector('#admin-request-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const values = Object.fromEntries(new FormData(form).entries());
      if (isLocalMode) {
        const requests = getStoredItems(REQUESTS_KEY);
        requests.unshift({ id: crypto.randomUUID(), owner: values.owner, phone: values.phone, status: 'pending', createdAt: new Date().toISOString() });
        saveStoredItems(REQUESTS_KEY, requests);
        form.reset();
        renderAdminRequests();
        renderRequestCount();
        showToast('Solicitud guardada localmente para la demostración.');
        return;
      }
      if (!client) return showToast('No se pudo conectar con Supabase para guardar la solicitud.');
      const { data, error } = await client.from('publication_requests').insert({ owner_name: values.owner, owner_phone: values.phone }).select('*').single();
      if (error) {
        console.error('No se pudo guardar la solicitud manual.', error);
        showToast(`No se pudo guardar la solicitud: ${error.message}`);
        return;
      }
      dataCache[REQUESTS_KEY].unshift(mapRequest(data));
      form.reset();
      renderAdminRequests();
      renderRequestCount();
      showToast('Solicitud guardada para contactar por WhatsApp.');
    });
  };

  const getContactNumber = () => publicContactNumber || '+591 700 00000';

  const updateContactLinks = () => {
    const number = getContactNumber();
    const digits = number.replace(/\D/g, '');
    document.querySelectorAll('[data-contact-link]').forEach((link) => { link.href = `https://wa.me/${digits}`; });
    document.querySelectorAll('[data-contact-text]').forEach((link) => { link.textContent = number; });
  };

  const renderPublishedPets = () => {
    const container = document.querySelector('#public-pets');
    if (!container) return;
    const pets = getStoredItems(PETS_KEY);
    const profileId = new URLSearchParams(window.location.hash.replace('#', '?')).get('mascota');
    const selectedPet = pets.find((pet) => pet.id === profileId);
    const profile = document.querySelector('[data-public-pet-profile]');
    document.body.classList.toggle('profile-only', Boolean(selectedPet));
    container.querySelectorAll('[data-generated-pet]').forEach((card) => card.remove());
    if (selectedPet) {
      if (profile) {
        profile.hidden = false;
        const medicalDetails = [['Enfermedades', selectedPet.diseases, selectedPet.publicDiseases], ['Problemas cardíacos', selectedPet.heartProblems, selectedPet.publicHeartProblems], ['Alergias', selectedPet.allergies, selectedPet.publicAllergies]].filter(([, value, isPublic]) => value && isPublic).map(([label, value]) => `<p><strong>${label}:</strong> ${value}</p>`).join('');
        const isLost = (selectedPet.status || 'lost') === 'lost';
        profile.innerHTML = `<div class="profile-photo"><img src="${selectedPet.photo || selectedPet.photoUrl || 'pet-placeholder.svg'}" alt="${selectedPet.name}"></div><div class="profile-content"><div class="eyebrow"><span class="material-symbols-outlined">${isLost ? 'warning' : 'pets'}</span>${isLost ? 'Mascota perdida' : 'Perfil de mascota'}</div><h1>${selectedPet.name}</h1><p>${selectedPet.species}${selectedPet.breed ? ` · ${selectedPet.breed}` : ''}${selectedPet.sex ? ` · ${selectedPet.sex}` : ''}</p><p><strong>Tamaño:</strong> ${getPetSizeLabel(selectedPet)}</p>${selectedPet.temperament ? `<p><strong>Temperamento:</strong> ${selectedPet.temperament}</p>` : ''}${isLost ? `<p><strong>Última ubicación:</strong> ${selectedPet.lastSeen || 'Zona por confirmar'}</p>` : ''}${medicalDetails ? `<section class="public-medical"><h2>Información importante</h2>${medicalDetails}</section>` : ''}<div class="profile-actions"><a class="btn btn-primary" data-contact-link href="#" target="_blank" rel="noopener"><span class="material-symbols-outlined">chat</span>Contactar</a><a class="btn btn-secondary" data-close-profile href="#perdidas">Cerrar</a></div></div>`;
        profile.querySelector('[data-close-profile]')?.addEventListener('click', () => {
          profile.hidden = true;
          document.querySelector('#perdidas')?.removeAttribute('hidden');
          history.replaceState(null, '', 'index.html#perdidas');
          renderPublishedPets();
          document.querySelector('#perdidas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        document.querySelector('#perdidas')?.setAttribute('hidden', '');
      }
    } else if (profile) {
      profile.hidden = true;
    }
    pets.filter((pet) => !profileId || pet.id !== profileId).forEach((pet) => {
      const card = document.createElement('article');
      card.className = 'card report-card';
      card.dataset.generatedPet = 'true';
      const petIsLost = (pet.status || 'lost') === 'lost';
      const petStatusLabel = petIsLost ? 'Perdida' : pet.status === 'reunited' ? 'Reencontrada' : 'Activa';
      card.innerHTML = `<a class="pet-profile-link" href="index.html#mascota=${pet.id}"><div class="photo-strip"><img src="${pet.photo || pet.photoUrl || 'pet-placeholder.svg'}" alt="${pet.name}"></div><div class="report-body"><div class="report-head"><div><h3>${pet.name}</h3><p>${pet.species}${pet.breed ? ` · ${pet.breed}` : ''}</p></div><div class="report-badges"><span class="size-chip">${getPetSizeLabel(pet)}</span><span class="status-chip ${petIsLost ? '' : 'seen'}">${petStatusLabel}</span></div></div><div class="report-meta">${petIsLost ? `<span><span class="material-symbols-outlined">location_on</span> ${pet.lastSeen || 'Zona por confirmar'}</span>` : ''}<span class="btn btn-primary">Ver perfil</span></div></div></a>`;
      container.appendChild(card);
    });
    if (!pets.length) container.innerHTML = '<p class="muted empty-state">Aún no hay perfiles publicados. La información aparecerá aquí cuando administración registre una mascota.</p>';
    updateContactLinks();
  };

  const setupAdminForms = () => {
    const contactForm = document.querySelector('#contact-settings-form');
    if (contactForm) {
      const input = document.querySelector('#admin-contact');
      input.value = getContactNumber();
      contactForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isLocalMode) {
          publicContactNumber = input.value.trim();
          localStorage.setItem(CONTACT_KEY, publicContactNumber);
          updateContactLinks();
          showToast('Número guardado en este navegador para la demostración.');
          return;
        }
        if (!client) return showToast('Supabase no está configurado.');
        const { error } = await client.from('app_settings').upsert({ setting_key: 'public_contact_phone', setting_value: input.value.trim(), updated_at: new Date().toISOString() });
        if (error) {
          console.error('No se pudo actualizar el teléfono público.', error);
          showToast(`No se pudo guardar el teléfono: ${error.message}`);
          return;
        }
        publicContactNumber = input.value.trim();
        updateContactLinks();
        showToast('Número de contacto actualizado.');
      });
    }
    const petForm = document.querySelector('#admin-pet-form');
    if (petForm && !petForm.querySelector('[name="size"]')) {
      const field = document.createElement('div');
      field.className = 'form-field injected-field';
      field.innerHTML = '<label for="admin-pet-size">Tamaño de la mascota *</label><select id="admin-pet-size" name="size" required><option value="">Selecciona el tamaño</option><option value="small">Pequeña</option><option value="medium">Mediana</option><option value="large">Grande</option></select>';
      petForm.querySelector('#admin-pet-breed')?.closest('.form-field')?.after(field);
    }
    const galleryInput = petForm?.querySelector('[data-pet-gallery]');
    const uploadLabel = galleryInput?.closest('.upload');
    let previewUrl = '';
    const clearPhotoPreview = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      uploadLabel?.querySelector('.upload-preview')?.remove();
      uploadLabel?.classList.remove('has-preview');
    };
    galleryInput?.addEventListener('change', () => {
      clearPhotoPreview();
      const imageFile = galleryInput.files?.[0];
      if (!imageFile || !uploadLabel) return;
      previewUrl = URL.createObjectURL(imageFile);
      const preview = document.createElement('img');
      preview.className = 'upload-preview';
      preview.src = previewUrl;
      preview.alt = 'Vista previa completa de la foto de la mascota';
      uploadLabel.prepend(preview);
      uploadLabel.classList.add('has-preview');
    });
    const fillPetForm = (pet) => {
      Object.entries({ ownerName: pet.ownerName, ownerPhone: pet.ownerPhone, ownerEmail: pet.ownerEmail, ownerAddress: pet.ownerAddress, ownerLocationLink: pet.ownerLocationLink, name: pet.name, species: pet.species, size: getPetSize(pet), breed: pet.breed, sex: pet.sex, temperament: pet.temperament, lastSeen: pet.lastSeen, status: pet.status || 'lost', diseases: pet.diseases, heartProblems: pet.heartProblems, allergies: pet.allergies, medications: pet.medications, vaccines: pet.vaccines, clinicalHistory: pet.clinicalHistory }).forEach(([name, value]) => {
        const input = petForm.elements[name];
        if (!input) return;
        if (input.tagName === 'SELECT' && value && !Array.from(input.options).some((option) => option.value === value)) {
          input.add(new Option(value, value));
        }
        input.value = value || '';
      });
      ['diseases', 'heartProblems', 'allergies'].forEach((name) => {
        const checkbox = petForm.elements[`public${name[0].toUpperCase()}${name.slice(1)}`];
        if (checkbox) checkbox.checked = Boolean(pet[`public${name[0].toUpperCase()}${name.slice(1)}`]);
      });
      petForm.dataset.editingId = pet.id;
      document.querySelector('[data-admin-view="anadir"]')?.click();
      petForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`Editando a ${pet.name}. Guarda los cambios para actualizarla.`);
    };
    if (petForm && !petForm.querySelector('[name="temperament"]')) {
      const field = document.createElement('div');
      field.className = 'form-field injected-field';
      field.innerHTML = '<label for="admin-pet-temperament">Temperamento</label><select id="admin-pet-temperament" name="temperament"><option value="">Sin especificar</option><option>Cariñoso</option><option>Tímido</option><option>Juguetón</option><option>Tranquilo</option><option>Asustadizo</option></select>';
      petForm.querySelector('#admin-pet-sex')?.closest('.form-field')?.after(field);
    }
    if (petForm && !petForm.querySelector('[name="status"]')) {
      const field = document.createElement('div');
      field.className = 'form-field injected-field';
      field.innerHTML = '<label for="admin-pet-status">Estado de la mascota</label><select id="admin-pet-status" name="status"><option value="lost">Modo perdida</option><option value="active">Activa</option><option value="reunited">Reencontrada</option></select><span class="private-note">Solo las mascotas en modo perdida muestran ubicación y alerta pública.</span>';
      petForm.querySelector('[name="lastSeen"]')?.closest('.form-field')?.before(field);
    }
    if (petForm && !petForm.querySelector('[name="diseases"]')) {
      const field = document.createElement('fieldset');
      field.className = 'medical-fields';
      field.innerHTML = '<legend>Historial clínico</legend><div class="form-grid two"><div class="form-field"><label>Enfermedades</label><textarea name="diseases" placeholder="Diagnósticos importantes"></textarea><label class="public-toggle"><input type="checkbox" name="publicDiseases"> Mostrar públicamente</label></div><div class="form-field"><label>Problemas cardíacos</label><textarea name="heartProblems" placeholder="Condición cardíaca"></textarea><label class="public-toggle"><input type="checkbox" name="publicHeartProblems"> Mostrar públicamente</label></div><div class="form-field"><label>Alergias</label><textarea name="allergies" placeholder="Alimentos o medicamentos"></textarea><label class="public-toggle"><input type="checkbox" name="publicAllergies"> Mostrar públicamente</label></div><div class="form-field"><label>Medicamentos y dosis</label><textarea name="medications" placeholder="Tratamiento actual"></textarea><span class="private-note">Solo administración</span></div><div class="form-field"><label>Vacunas</label><textarea name="vaccines" placeholder="Vacunas y fechas"></textarea><span class="private-note">Solo administración</span></div><div class="form-field"><label>Notas clínicas privadas</label><textarea name="clinicalHistory" placeholder="Información solo para administración"></textarea><span class="private-note">Solo administración</span></div></div><p class="muted medical-note">Los campos sin seleccionar permanecen privados.</p>';
      petForm.querySelector('[name="lastSeen"]')?.closest('.form-field')?.after(field);
    }
    if (petForm && !petForm.querySelector('[name="ownerLocationLink"]')) {
      const field = document.createElement('div');
      field.className = 'form-field injected-field';
      field.innerHTML = '<label for="admin-owner-location-link">Link de ubicación de la casa</label><input id="admin-owner-location-link" name="ownerLocationLink" type="url" placeholder="https://maps.google.com/...">';
      petForm.querySelector('#admin-owner-address')?.closest('.form-field')?.after(field);
      petForm.querySelector('#admin-owner-latitude')?.closest('.form-field')?.setAttribute('hidden', '');
      petForm.querySelector('#admin-owner-longitude')?.closest('.form-field')?.setAttribute('hidden', '');
    }
    if (petForm) petForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!petForm.checkValidity()) { petForm.reportValidity(); return; }
      const pet = Object.fromEntries(new FormData(petForm).entries());
      pet.publicDiseases = pet.publicDiseases === 'on';
      pet.publicHeartProblems = pet.publicHeartProblems === 'on';
      pet.publicAllergies = pet.publicAllergies === 'on';
      const galleryFile = petForm.querySelector('[data-pet-gallery]')?.files[0];
      if (!client && !isLocalMode) return showToast('No hay una conexión activa para guardar la mascota.');
      if (galleryFile && (!['image/jpeg', 'image/png', 'image/webp'].includes(galleryFile.type) || galleryFile.size > 5242880)) {
        showToast('Usa una imagen JPG, PNG o WEBP de hasta 5 MB.');
        return;
      }
      const pets = getStoredItems(PETS_KEY);
      const owners = getStoredItems(OWNERS_KEY);
      const editingId = petForm.dataset.editingId;
      const existingPet = pets.find((storedPet) => storedPet.id === editingId);
      const matchingOwnerByPhone = owners.find((owner) => normalizePhone(owner.phone) && normalizePhone(owner.phone) === normalizePhone(pet.ownerPhone));
      if (isLocalMode) {
        try {
          const ownerId = existingPet?.ownerId || matchingOwnerByPhone?.id || crypto.randomUUID();
          const petId = editingId || crypto.randomUUID();
          const matchingOwner = owners.find((owner) => owner.id === ownerId);
          const owner = {
            id: ownerId,
            name: pet.ownerName.trim(),
            phone: pet.ownerPhone.trim(),
            email: pet.ownerEmail.trim(),
            address: pet.ownerAddress.trim(),
            locationLink: pet.ownerLocationLink.trim()
          };
          const savedPet = {
            ...pet,
            id: petId,
            ownerId,
            ownerName: owner.name,
            ownerPhone: owner.phone,
            ownerEmail: owner.email,
            ownerAddress: owner.address,
            ownerLocationLink: owner.locationLink,
            photo: galleryFile ? await createLocalPhoto(galleryFile) : existingPet?.photo || '',
            qrUrl: new URL(`index.html#mascota=${petId}`, window.location.href).href,
            createdAt: existingPet?.createdAt || new Date().toISOString()
          };
          saveStoredItems(PETS_KEY, [savedPet, ...pets.filter((storedPet) => storedPet.id !== petId)]);
          saveStoredItems(OWNERS_KEY, matchingOwner
            ? owners.map((storedOwner) => storedOwner.id === ownerId ? owner : storedOwner)
            : [...owners, owner]);
          pet.id = petId;
          pet.qrUrl = savedPet.qrUrl;
          petForm.reset();
          clearPhotoPreview();
          delete petForm.dataset.editingId;
          renderAdminPets();
          renderAdminOwners();
          renderAdminStats();
          renderPetQr(savedPet);
          showToast(`${pet.name} se guardó en este navegador y ya está en el listado de demostración.`);
        } catch (error) {
          console.error('No se pudo guardar el perfil en el modo local.', error);
          showToast(`No se pudo guardar el perfil. ${error.name === 'QuotaExceededError' ? 'El almacenamiento local está lleno; prueba con una foto más pequeña.' : error.message}`);
        }
        return;
      }
      const ownerId = existingPet?.ownerId || matchingOwnerByPhone?.id || crypto.randomUUID();
      const petId = editingId || crypto.randomUUID();
      const userResult = await client.auth.getUser();
      if (userResult.error || !userResult.data.user) {
        showToast('Tu sesión venció. Vuelve a iniciar sesión.');
        window.location.replace('login.html?next=panel.html');
        return;
      }
      const owner = {
        id: ownerId,
        full_name: pet.ownerName.trim(),
        phone: pet.ownerPhone.trim(),
        email: pet.ownerEmail.trim() || null,
        address_label: pet.ownerAddress.trim(),
        location_url: pet.ownerLocationLink.trim() || null
      };
      const { error: ownerError } = await client.from('owners').upsert(owner);
      if (ownerError) {
        console.error('No se pudo guardar el propietario.', ownerError);
        showToast(`No se pudo guardar el propietario: ${ownerError.message}`);
        return;
      }
      let photoPath = existingPet?.photoPath || null;
      if (galleryFile) {
        const safeName = galleryFile.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
        photoPath = `${userResult.data.user.id}/${petId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await client.storage.from('pet-photos').upload(photoPath, galleryFile, { contentType: galleryFile.type, upsert: false });
        if (uploadError) {
          console.error('No se pudo subir la foto de la mascota.', uploadError);
          showToast(`No se pudo subir la foto: ${uploadError.message}`);
          return;
        }
      }
      const petRow = {
        id: petId,
        owner_id: ownerId,
        name: pet.name.trim(),
        species: pet.species,
        breed: pet.breed.trim() || null,
        size: pet.size,
        sex: pet.sex || null,
        temperament: pet.temperament || null,
        last_seen_place: pet.lastSeen.trim(),
        status: pet.status || 'lost',
        photo_path: photoPath,
        diseases: pet.diseases || null,
        public_diseases: pet.publicDiseases,
        heart_problems: pet.heartProblems || null,
        public_heart_problems: pet.publicHeartProblems,
        allergies: pet.allergies || null,
        public_allergies: pet.publicAllergies,
        medications: pet.medications || null,
        vaccines: pet.vaccines || null,
        clinical_history: pet.clinicalHistory || null
      };
      const { data: savedPetRow, error: petError } = await client.from('pets').upsert(petRow).select('*').single();
      if (petError) {
        console.error('No se pudo guardar el perfil de la mascota.', petError);
        showToast(`No se pudo guardar la mascota: ${petError.message}`);
        return;
      }
      const { error: qrError } = await client.from('qr_tags').upsert({ pet_id: petId }, { onConflict: 'pet_id' });
      if (qrError) {
        console.error('No se pudo preparar el código QR.', qrError);
        showToast(`La mascota se guardó, pero no se pudo crear su QR: ${qrError.message}`);
        return;
      }
      const savedPet = mapPet(savedPetRow);
      savedPet.qrUrl = new URL(`index.html#mascota=${petId}`, window.location.href).href;
      const ownerIndex = owners.findIndex((storedOwner) => storedOwner.id === ownerId);
      const savedOwner = mapOwner({ ...owner, id: ownerId });
      Object.assign(savedPet, {
        ownerName: savedOwner.name,
        ownerPhone: savedOwner.phone,
        ownerEmail: savedOwner.email,
        ownerAddress: savedOwner.address,
        ownerLocationLink: savedOwner.locationLink
      });
      saveStoredItems(PETS_KEY, [savedPet, ...pets.filter((storedPet) => storedPet.id !== petId)]);
      if (ownerIndex >= 0) owners[ownerIndex] = savedOwner;
      else owners.push(savedOwner);
      saveStoredItems(OWNERS_KEY, owners);
      pet.id = petId;
      pet.qrUrl = savedPet.qrUrl;
      petForm.reset();
      clearPhotoPreview();
      delete petForm.dataset.editingId;
      renderAdminPets();
      renderAdminOwners();
      renderAdminStats();
      renderPetQr(pet);
      showToast(`${pet.name} quedó ${editingId ? 'actualizada' : 'añadida'} en el listado público.`);
    });
    window.guardianEditPet = fillPetForm;
  };

  const renderAdminPets = () => {
    const container = document.querySelector('[data-admin-pet-list]');
    const pets = getStoredItems(PETS_KEY);
    const publishedContainer = document.querySelector('[data-admin-published-pets]') || document.querySelector('[data-admin-panel="perdidas"] .report-grid');
    if (publishedContainer) {
      publishedContainer.innerHTML = pets.length ? pets.map((pet) => {
        const petIsLost = (pet.status || 'lost') === 'lost';
        const statusLabel = petIsLost ? 'Perdida' : pet.status === 'reunited' ? 'Reencontrada' : 'Activa';
        const photo = pet.photo || pet.photoUrl || 'pet-placeholder.svg';
        return `<article class="card report-card"><img src="${photo}" alt="${pet.name}"><div class="report-body"><div class="report-head"><div><h3>${pet.name}</h3><p>${pet.species}${pet.breed ? ` · ${pet.breed}` : ''}${pet.sex ? ` · ${pet.sex}` : ''}</p></div><div class="report-badges"><span class="size-chip">${getPetSizeLabel(pet)}</span><span class="status-chip ${petIsLost ? '' : 'seen'}">${statusLabel}</span></div></div><div class="report-meta">${petIsLost ? `<span><span class="material-symbols-outlined">location_on</span> ${pet.lastSeen || 'Zona por confirmar'}</span>` : ''}<a class="btn btn-primary" href="index.html#mascota=${pet.id}">Ver perfil público</a></div></div></article>`;
      }).join('') : '<p class="muted empty-state">Aún no hay mascotas publicadas. Registra el primer perfil para comenzar.</p>';
    }
    if (!container) return;
    container.replaceChildren();
    if (!pets.length) {
      const empty = document.createElement('p');
      empty.className = 'muted empty-state';
      empty.textContent = 'Aún no hay mascotas registradas.';
      container.appendChild(empty);
      return;
    }
    pets.slice().reverse().forEach((pet) => {
      const currentStatus = pet.status || 'lost';
      const item = document.createElement('article');
      item.className = 'request-item';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = pet.name;
      const metadata = document.createElement('p');
      metadata.textContent = `${pet.species}${pet.breed ? ` · ${pet.breed}` : ''} · ${pet.ownerName || 'Sin dueño'}`;
      details.append(name, metadata);
      const status = document.createElement('span');
      status.className = `request-status ${currentStatus === 'lost' ? 'rejected' : 'approved'}`;
      status.textContent = currentStatus === 'lost' ? 'Perdida' : currentStatus === 'reunited' ? 'Reencontrada' : 'Activa';
      const actions = document.createElement('div');
      actions.className = 'request-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-secondary btn-small';
      editButton.dataset.editPet = pet.id;
      editButton.textContent = 'Editar';
      const statusButton = document.createElement('button');
      statusButton.type = 'button';
      statusButton.className = 'btn btn-secondary btn-small';
      statusButton.dataset.togglePetStatus = pet.id;
      statusButton.textContent = currentStatus === 'lost' ? 'Marcar reencontrada' : 'Marcar como perdida';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-danger btn-small';
      deleteButton.dataset.deletePet = pet.id;
      deleteButton.textContent = 'Borrar';
      actions.append(editButton, statusButton, deleteButton);
      item.append(details, status, actions);
      container.appendChild(item);
    });
    container.querySelectorAll('[data-edit-pet]').forEach((button) => button.addEventListener('click', () => {
      const pet = pets.find((storedPet) => storedPet.id === button.dataset.editPet);
      if (pet && window.guardianEditPet) window.guardianEditPet(pet);
    }));
    container.querySelectorAll('[data-toggle-pet-status]').forEach((button) => button.addEventListener('click', async () => {
      const pet = pets.find((storedPet) => storedPet.id === button.dataset.togglePetStatus);
      if (!pet) return;
      const nextStatus = (pet.status || 'lost') === 'lost' ? 'reunited' : 'lost';
      button.disabled = true;
      try {
        if (!isLocalMode) {
          const { data, error } = await client.from('pets').update({ status: nextStatus }).eq('id', pet.id).select('*').single();
          throwIfCloudError(error);
          Object.assign(pet, mapPet(data));
        } else pet.status = nextStatus;
        saveStoredItems(PETS_KEY, pets);
        renderAdminPets();
        renderAdminOwners();
        renderAdminStats();
        showToast(`${pet.name}: estado actualizado a ${nextStatus === 'lost' ? 'perdida' : 'reencontrada'}.`);
      } catch (error) {
        console.error('No se pudo cambiar el estado de la mascota.', error);
        showToast(`No se pudo cambiar el estado: ${error.message}`);
      }
    }));
    container.querySelectorAll('[data-delete-pet]').forEach((button) => button.addEventListener('click', async () => {
      const pet = pets.find((storedPet) => storedPet.id === button.dataset.deletePet);
      if (!pet) return;
      const ownerHasOtherPets = pets.some((storedPet) => storedPet.id !== pet.id && storedPet.ownerId === pet.ownerId);
      const confirmation = ownerHasOtherPets
        ? `¿Borrar el perfil de ${pet.name}? Los datos del dueño y sus demás mascotas se conservarán.`
        : `¿Borrar el perfil de ${pet.name}? También se eliminarán los datos del dueño porque no tiene más mascotas.`;
      if (!window.confirm(confirmation)) return;
      if (!isLocalMode) {
        if (!client) return showToast('No hay una conexión activa para borrar la mascota.');
        const { error } = await client.from('pets').delete().eq('id', pet.id);
        if (error) {
          console.error('No se pudo borrar el perfil de mascota.', error);
          showToast(`No se pudo borrar: ${error.message}`);
          return;
        }
      }
      saveStoredItems(PETS_KEY, pets.filter((storedPet) => storedPet.id !== pet.id));
      if (!ownerHasOtherPets) {
        if (!isLocalMode) {
          const { error: ownerError } = await client.from('owners').delete().eq('id', pet.ownerId);
          if (ownerError) {
            console.error('Se borró la mascota, pero no se pudo borrar su propietario.', ownerError);
            renderAdminPets();
            renderAdminOwners();
            renderAdminStats();
            showToast(`Mascota borrada, pero no se pudo borrar el propietario: ${ownerError.message}`);
            return;
          }
        }
        saveStoredItems(OWNERS_KEY, getStoredItems(OWNERS_KEY).filter((owner) => owner.id !== pet.ownerId));
      }
      renderAdminPets();
      renderAdminOwners();
      renderAdminStats();
      showToast(`${pet.name} fue borrada.`);
    }));
  };

  const renderAdminOwners = () => {
    let container = document.querySelector('[data-admin-owner-list]');
    if (!container) {
      const ownersPanel = document.querySelector('[data-admin-panel="duenos"]');
      if (!ownersPanel) return;
      const heading = document.createElement('h2');
      heading.textContent = 'Propietarios y sus mascotas';
      heading.className = 'owner-list-heading';
      container = document.createElement('div');
      container.className = 'request-list';
      container.dataset.adminOwnerList = '';
      ownersPanel.append(heading, container);
    }
    const pets = getStoredItems(PETS_KEY);
    const owners = getStoredItems(OWNERS_KEY);
    const groupedOwners = new Map();
    owners.forEach((owner) => {
      const key = getOwnerGroupKey(owner);
      if (!groupedOwners.has(key)) groupedOwners.set(key, { owner, pets: [] });
      const group = groupedOwners.get(key);
      if (!group.owner.email && owner.email) group.owner.email = owner.email;
      if (!group.owner.address && owner.address) group.owner.address = owner.address;
      if (!group.owner.locationLink && owner.locationLink) group.owner.locationLink = owner.locationLink;
      group.pets.push(...pets.filter((pet) => pet.ownerId === owner.id || (!pet.ownerId && pet.ownerName === owner.name)));
    });
    container.replaceChildren();
    if (!owners.length) {
      const empty = document.createElement('p');
      empty.className = 'muted empty-state';
      empty.textContent = 'Aún no hay dueños registrados. Añádelos al registrar una mascota.';
      container.appendChild(empty);
      return;
    }
    groupedOwners.forEach(({ owner, pets: ownerPets }) => {
      const item = document.createElement('article');
      item.className = 'request-item owner-item';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = owner.name || 'Sin nombre';
      const contact = document.createElement('p');
      contact.textContent = `${owner.phone || 'Sin teléfono'}${owner.email ? ` · ${owner.email}` : ''}`;
      const petNames = document.createElement('p');
      petNames.textContent = `Mascotas: ${ownerPets.length ? ownerPets.map((pet) => pet.name).join(', ') : 'Sin mascotas registradas'}`;
      details.append(name, contact, petNames);
      const count = document.createElement('span');
      count.className = 'request-status approved';
      count.textContent = `${ownerPets.length} ${ownerPets.length === 1 ? 'mascota' : 'mascotas'}`;
      item.append(details, count);
      container.appendChild(item);
    });
  };

  const renderAdminStats = () => {
    const owners = getStoredItems(OWNERS_KEY);
    const pets = getStoredItems(PETS_KEY);
    const ownerGroups = new Set(owners.map(getOwnerGroupKey));
    const stats = document.querySelectorAll('[data-admin-panel="resumen"] .stats .stat strong');
    const lostPets = pets.filter((pet) => (pet.status || 'lost') === 'lost');
    const reunitedPets = pets.filter((pet) => pet.status === 'reunited');
    stats[0]?.replaceChildren(document.createTextNode(pets.length.toLocaleString('es-BO')));
    stats[1]?.replaceChildren(document.createTextNode(lostPets.length.toLocaleString('es-BO')));
    stats[2]?.replaceChildren(document.createTextNode(reunitedPets.length.toLocaleString('es-BO')));
    document.querySelector('[data-owner-total]')?.replaceChildren(document.createTextNode(ownerGroups.size));
    document.querySelector('[data-pet-total]')?.replaceChildren(document.createTextNode(pets.length));
  };

  const renderPetQr = (pet) => {
    const result = document.querySelector('[data-qr-result]');
    const output = document.querySelector('[data-qr-output]');
    if (!result || !output || typeof QRCode === 'undefined') return;
    output.replaceChildren();
    new QRCode(output, { text: pet.qrUrl, width: 220, height: 220, colorDark: '#1b1c1c', colorLight: '#ffffff' });
    result.hidden = false;
    result.querySelector('[data-qr-title]').textContent = `QR de ${pet.name}`;
    result.querySelector('[data-qr-download]').onclick = () => {
      const image = output.querySelector('img') || output.querySelector('canvas');
      if (!image) return;
      const link = document.createElement('a');
      link.download = `nubivet-qr-${pet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      link.href = image.tagName === 'CANVAS' ? image.toDataURL('image/png') : image.src;
      link.click();
    };
    result.querySelector('[data-qr-print]').onclick = () => {
      const image = output.querySelector('img') || output.querySelector('canvas');
      if (!image) return;
      const printWindow = window.open('', '_blank', 'width=420,height=520');
      printWindow.document.write(`<title>Nubivet - ${pet.name}</title><img src="${image.tagName === 'CANVAS' ? image.toDataURL('image/png') : image.src}" alt="QR de ${pet.name}" style="width:300px;display:block;margin:40px auto"><h2 style="text-align:center;font-family:Arial">${pet.name} · NUBIVET</h2>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    };
  };

  const setupPage = async () => {
    setupBranding();
    const cloudReady = await initializeCloud();
    applyPublicCover();
    if (!cloudReady) {
      document.querySelectorAll('#public-report-form, #admin-request-form, #admin-pet-form, #contact-settings-form').forEach((form) => {
        form.querySelector('[type="submit"]')?.setAttribute('disabled', '');
      });
      if (document.body.dataset.page === 'login' && !hasCloudConfiguration()) {
        const error = document.querySelector('#login-error');
        if (error) error.textContent = 'Configura las credenciales de Supabase antes de iniciar sesión.';
      }
      if (document.body.dataset.page === 'panel') document.querySelector('.dashboard-layout')?.setAttribute('hidden', '');
      return;
    }
    setupLogin();
    setupLogout();
    setupReportForm();
    if (document.body.dataset.page === 'panel') setupAdminModules();
    setupCoverEditor();
    setupAdminForms();
    setupAdminNavigation();
    setupAdminRequestForm();
    if (cloudReady) {
      renderAdminRequests();
      renderAdminPets();
      renderAdminOwners();
      renderAdminStats();
      renderPublishedPets();
      window.addEventListener('hashchange', renderPublishedPets);
      renderRequestCount();
      updateContactLinks();
    }
    if (document.body.dataset.page === 'panel' && cloudReady) document.body.classList.add('cloud-ready');
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = new Date().getFullYear();
  };

  document.addEventListener('DOMContentLoaded', () => { setupPage().catch((error) => {
    console.error('No se pudo iniciar la aplicación NUBIVET.', error);
    setConnectionNotice(`No se pudo iniciar la aplicación: ${error.message}`);
  }); });
})();
