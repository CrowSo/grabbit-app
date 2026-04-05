/* ============================================================
   GRABBIT — i18n.js
   Translations: Español, English, Português
   ============================================================ */

const translations = {
  es: {
    // Nav
    nav_download:  'Download',
    nav_queue:     'Cola',
    nav_library:   'Librería',
    nav_settings:  'Ajustes',
    nav_license:   'Licencia',
    nav_light:     'Modo claro',
    nav_dark:      'Modo oscuro',

    // Download page
    page_download:         'Download',
    paste_link:            'Pega tu enlace',
    url_placeholder:       'https://www.youtube.com/watch?v=...',
    btn_fetch:             'Buscar',
    btn_fetching:          'Buscando...',
    section_format:        'Formato',
    section_quality:       'Calidad',
    section_segment:       'Segmento',
    segment_hint:          'opcional — descarga solo una parte',
    format_video_audio:    'Video + Audio',
    format_video:          'Solo video',
    format_audio:          'Solo audio',
    quality_best:          'Mejor',
    btn_clear:             'Limpiar',
    btn_add_queue:         'Agregar a cola',
    hint_paste:            'Pega un enlace arriba para comenzar',
    hint_platforms:        'YouTube · TikTok · Instagram · Facebook · Twitter · Pinterest · Twitch',

    // Queue page
    page_queue:            'Cola',
    queue_items:           'elementos',
    queue_item:            'elemento',
    btn_clear_completed:   'Limpiar completados',
    queue_empty_msg:       'No hay descargas aún',
    status_waiting:        'Esperando',
    status_downloading:    'Descargando',
    status_done:           'Listo',
    status_error:          'Error',

    // Library page
    page_library:          'Librería',
    filter_all:            'Todo',
    filter_video:          'Video',
    filter_audio:          'Audio',
    sort_newest:           'Más recientes',
    sort_oldest:           'Más antiguos',
    sort_name:             'Nombre',
    library_empty_msg:     'Los archivos descargados aparecerán aquí',
    today:                 'Hoy',
    yesterday:             'Ayer',

    // Settings page
    page_settings:         'Ajustes',
    settings_downloads:    'Descargas',
    settings_appearance:   'Apariencia',
    settings_language:     'Idioma',
    settings_about:        'Acerca de',
    save_folder:           'Carpeta de destino',
    btn_browse:            'Explorar',
    default_quality:       'Calidad por defecto',
    default_format:        'Formato por defecto',
    theme_label:           'Tema',
    premium_themes:        'Temas premium',
    version:               'Versión',
    btn_update_ytdlp:      'Actualizar yt-dlp',
    btn_update_ffmpeg:     'Actualizar FFmpeg',
    tool_ok:               '✓ Instalado',
    tool_updating:         '⟳ Actualizando...',
    tool_installing:       '⬇ Instalando...',
    tool_error:            '✗ Error',
    tool_checking:         '... Verificando',

    // License page
    page_license:          'Licencia',
    license_activate:      'Activar licencia',
    license_free_title:    'Plan gratuito',
    license_free_sub:      'Activa una clave para desbloquear todo',
    license_pro_title:     'Plan Pro — Activo',
    license_pro_sub:       'Todas las funciones desbloqueadas',
    license_days_left:     'días restantes',
    license_hint:          'Ingresa tu código de activación. Puedes comprar una licencia sin crear cuenta.',
    btn_activate:          'Activar',
    btn_activating:        'Verificando...',
    license_success:       '✓ Licencia activada correctamente',
    license_invalid:       'Clave inválida o expirada.',
    license_connection:    'No se pudo verificar. Revisa tu conexión.',
    plan_free:             'Gratis',
    plan_pro:              'Pro',
    free_limit_1:          '5 descargas / día',
    free_limit_2:          'Hasta 720p',
    free_limit_3:          'YouTube y TikTok',
    pro_feat_1:            'Descargas ilimitadas',
    pro_feat_2:            'Hasta 4K / 8K',
    pro_feat_3:            'Todas las plataformas',
    pro_feat_4:            'Descarga por segmento',
    pro_feat_5:            'Temas premium',
    pro_feat_6:            'Soporte prioritario',
    btn_get_pro:           'Obtener Pro →',

    // Toasts / errors
    err_empty_url:         'Pega un enlace primero',
    err_fetch_failed:      'No se pudo obtener el video. Revisa el enlace.',
  },

  en: {
    nav_download:  'Download',
    nav_queue:     'Queue',
    nav_library:   'Library',
    nav_settings:  'Settings',
    nav_license:   'License',
    nav_light:     'Light mode',
    nav_dark:      'Dark mode',
    page_download:         'Download',
    paste_link:            'Paste your link',
    url_placeholder:       'https://www.youtube.com/watch?v=...',
    btn_fetch:             'Fetch',
    btn_fetching:          'Fetching...',
    section_format:        'Format',
    section_quality:       'Quality',
    section_segment:       'Segment',
    segment_hint:          'optional — download only a portion',
    format_video_audio:    'Video + Audio',
    format_video:          'Video only',
    format_audio:          'Audio only',
    quality_best:          'Best',
    btn_clear:             'Clear',
    btn_add_queue:         'Add to Queue',
    hint_paste:            'Paste a link above to get started',
    hint_platforms:        'YouTube · TikTok · Instagram · Facebook · Twitter · Pinterest · Twitch',
    page_queue:            'Queue',
    queue_items:           'items',
    queue_item:            'item',
    btn_clear_completed:   'Clear completed',
    queue_empty_msg:       'No downloads yet',
    status_waiting:        'Waiting',
    status_downloading:    'Downloading',
    status_done:           'Done',
    status_error:          'Error',
    page_library:          'Library',
    filter_all:            'All',
    filter_video:          'Video',
    filter_audio:          'Audio',
    sort_newest:           'Newest',
    sort_oldest:           'Oldest',
    sort_name:             'Name',
    library_empty_msg:     'Downloaded files will appear here',
    today:                 'Today',
    yesterday:             'Yesterday',
    page_settings:         'Settings',
    settings_downloads:    'Downloads',
    settings_appearance:   'Appearance',
    settings_language:     'Language',
    settings_about:        'About',
    save_folder:           'Save folder',
    btn_browse:            'Browse',
    default_quality:       'Default quality',
    default_format:        'Default format',
    theme_label:           'Theme',
    premium_themes:        'Premium themes',
    version:               'Version',
    btn_update_ytdlp:      'Update yt-dlp',
    btn_update_ffmpeg:     'Update FFmpeg',
    tool_ok:               '✓ Installed',
    tool_updating:         '⟳ Updating...',
    tool_installing:       '⬇ Installing...',
    tool_error:            '✗ Error',
    tool_checking:         '... Checking',
    page_license:          'License',
    license_activate:      'Activate license',
    license_free_title:    'Free plan',
    license_free_sub:      'Activate a key to unlock all features',
    license_pro_title:     'Pro plan — Active',
    license_pro_sub:       'All features unlocked',
    license_days_left:     'days left',
    license_hint:          'Enter your activation code. You can purchase a license without creating an account.',
    btn_activate:          'Activate',
    btn_activating:        'Checking...',
    license_success:       '✓ License activated successfully',
    license_invalid:       'Invalid or expired license key.',
    license_connection:    'Could not verify. Check your connection.',
    plan_free:             'Free',
    plan_pro:              'Pro',
    free_limit_1:          '5 downloads / day',
    free_limit_2:          'Up to 720p',
    free_limit_3:          'YouTube & TikTok',
    pro_feat_1:            'Unlimited downloads',
    pro_feat_2:            'Up to 4K / 8K',
    pro_feat_3:            'All platforms',
    pro_feat_4:            'Segment download',
    pro_feat_5:            'Premium themes',
    pro_feat_6:            'Priority support',
    btn_get_pro:           'Get Pro →',
    err_empty_url:         'Paste a link first',
    err_fetch_failed:      'Could not fetch video. Check the URL.',
  },

  pt: {
    nav_download:  'Download',
    nav_queue:     'Fila',
    nav_library:   'Biblioteca',
    nav_settings:  'Configurações',
    nav_license:   'Licença',
    nav_light:     'Modo claro',
    nav_dark:      'Modo escuro',
    page_download:         'Download',
    paste_link:            'Cole seu link',
    url_placeholder:       'https://www.youtube.com/watch?v=...',
    btn_fetch:             'Buscar',
    btn_fetching:          'Buscando...',
    section_format:        'Formato',
    section_quality:       'Qualidade',
    section_segment:       'Segmento',
    segment_hint:          'opcional — baixe apenas uma parte',
    format_video_audio:    'Vídeo + Áudio',
    format_video:          'Só vídeo',
    format_audio:          'Só áudio',
    quality_best:          'Melhor',
    btn_clear:             'Limpar',
    btn_add_queue:         'Adicionar à fila',
    hint_paste:            'Cole um link acima para começar',
    hint_platforms:        'YouTube · TikTok · Instagram · Facebook · Twitter · Pinterest · Twitch',
    page_queue:            'Fila',
    queue_items:           'itens',
    queue_item:            'item',
    btn_clear_completed:   'Limpar concluídos',
    queue_empty_msg:       'Nenhum download ainda',
    status_waiting:        'Aguardando',
    status_downloading:    'Baixando',
    status_done:           'Concluído',
    status_error:          'Erro',
    page_library:          'Biblioteca',
    filter_all:            'Tudo',
    filter_video:          'Vídeo',
    filter_audio:          'Áudio',
    sort_newest:           'Mais recentes',
    sort_oldest:           'Mais antigos',
    sort_name:             'Nome',
    library_empty_msg:     'Os arquivos baixados aparecerão aqui',
    today:                 'Hoje',
    yesterday:             'Ontem',
    page_settings:         'Configurações',
    settings_downloads:    'Downloads',
    settings_appearance:   'Aparência',
    settings_language:     'Idioma',
    settings_about:        'Sobre',
    save_folder:           'Pasta de destino',
    btn_browse:            'Navegar',
    default_quality:       'Qualidade padrão',
    default_format:        'Formato padrão',
    theme_label:           'Tema',
    premium_themes:        'Temas premium',
    version:               'Versão',
    btn_update_ytdlp:      'Atualizar yt-dlp',
    btn_update_ffmpeg:     'Atualizar FFmpeg',
    tool_ok:               '✓ Instalado',
    tool_updating:         '⟳ Atualizando...',
    tool_installing:       '⬇ Instalando...',
    tool_error:            '✗ Erro',
    tool_checking:         '... Verificando',
    page_license:          'Licença',
    license_activate:      'Ativar licença',
    license_free_title:    'Plano gratuito',
    license_free_sub:      'Ative uma chave para desbloquear tudo',
    license_pro_title:     'Plano Pro — Ativo',
    license_pro_sub:       'Todos os recursos desbloqueados',
    license_days_left:     'dias restantes',
    license_hint:          'Insira seu código de ativação. Você pode comprar uma licença sem criar conta.',
    btn_activate:          'Ativar',
    btn_activating:        'Verificando...',
    license_success:       '✓ Licença ativada com sucesso',
    license_invalid:       'Chave inválida ou expirada.',
    license_connection:    'Não foi possível verificar. Verifique sua conexão.',
    plan_free:             'Grátis',
    plan_pro:              'Pro',
    free_limit_1:          '5 downloads / dia',
    free_limit_2:          'Até 720p',
    free_limit_3:          'YouTube e TikTok',
    pro_feat_1:            'Downloads ilimitados',
    pro_feat_2:            'Até 4K / 8K',
    pro_feat_3:            'Todas as plataformas',
    pro_feat_4:            'Download por segmento',
    pro_feat_5:            'Temas premium',
    pro_feat_6:            'Suporte prioritário',
    btn_get_pro:           'Obter Pro →',
    err_empty_url:         'Cole um link primeiro',
    err_fetch_failed:      'Não foi possível buscar o vídeo. Verifique o link.',
  }
};

// ── Active language ────────────────────────────────────────
let currentLang = localStorage.getItem('grabbit-lang') || 'en';

window.t = function(key) {
  return (translations[currentLang] || translations['en'])[key] || key;
};

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('grabbit-lang', lang);

  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (el.placeholder !== undefined && el.dataset.i18nAttr === 'placeholder') {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });

  // Update placeholders separately
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // Update page title
  const titleKey = `page_${state?.currentPage || 'download'}`;
  const titleEl  = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = t(titleKey);

  // Update theme toggle label
  const themeLabel = document.getElementById('theme-label');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (themeLabel) themeLabel.textContent = t(isDark ? 'nav_light' : 'nav_dark');

  // Sync language selector
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = lang;
}

// ── Hook language selector ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('lang-select');
  if (sel) {
    sel.addEventListener('change', () => applyLanguage(sel.value));
  }
  applyLanguage(currentLang);
});