/**
 * storage.js - 数据持久化层
 * 封装 localStorage 操作，管理日程事件、里程记录与账户。
 *
 * 账户隔离：所有事件/里程/设置数据按账户 id 命名空间存储，
 * 形如 schedule_manager_events__<accountId>。切换账户即切换 activeAccount。
 */

const Storage = {
  KEYS: {
    // 旧版全局 key（仅用于首次迁移，迁移后删除）
    EVENTS_LEGACY: 'schedule_manager_events',
    MILEAGES_LEGACY: 'schedule_manager_mileages',
    SETTINGS_LEGACY: 'schedule_manager_settings',
    // 账户元数据
    ACCOUNTS: 'schedule_manager_accounts',
    CURRENT: 'schedule_manager_current'
  },

  // 当前激活账户 id（由 ensureInitialized / setCurrentAccount 维护）

  // 默认分类（用于新账户 / 未自定义时的种子）
  DEFAULT_CATEGORIES: [
    { name: '策划', color: '#8b5cf6', keywords: ['策划', '筹划', '企划'] },
    { name: '拍摄', color: '#ec4899', keywords: ['拍摄', '摄影', '拍照', '取景', '布光', '外景', '拍'] },
    { name: '剪辑', color: '#f59e0b', keywords: ['剪辑', '剪片', '后期', '精修', '调色'] },
    { name: '摸鱼', color: '#14b8a6', keywords: ['摸鱼', '划水', '摸会儿鱼', '偷闲', '偷懒', '摆烂', '发呆', '放空', '躺平', '歇会儿', '休息一下', '放松一下'] },
    { name: '其他', color: '#6366f1', keywords: [] }
  ],
  activeAccount: null,

  // ==================== 账户管理 ====================

  getAccounts() {
    try {
      const d = localStorage.getItem(this.KEYS.ACCOUNTS);
      return d ? JSON.parse(d) : [];
    } catch (e) {
      return [];
    }
  },

  saveAccounts(list) {
    localStorage.setItem(this.KEYS.ACCOUNTS, JSON.stringify(list));
  },

  getAccount(id) {
    return this.getAccounts().find(a => a.id === id) || null;
  },

  getCurrentAccountId() {
    return localStorage.getItem(this.KEYS.CURRENT) || null;
  },

  setCurrentAccount(id) {
    this.activeAccount = id;
    if (id) {
      localStorage.setItem(this.KEYS.CURRENT, id);
    } else {
      localStorage.removeItem(this.KEYS.CURRENT);
    }
  },

  /**
   * 创建账户
   * @param {string} name - 账户名称
   * @returns {Object} 新建的账户对象
   */
  createAccount(name) {
    const list = this.getAccounts();
    const acc = {
      id: this.generateId(),
      name: (name && name.trim()) || ('账户' + (list.length + 1)),
      createdAt: new Date().toISOString()
    };
    list.push(acc);
    this.saveAccounts(list);
    return acc;
  },

  /**
   * 重命名账户（只改 accounts 元数据，不影响其数据命名空间）
   * @param {string} id
   * @param {string} name
   * @returns {boolean} 是否成功
   */
  renameAccount(id, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    const list = this.getAccounts();
    const acc = list.find(a => a.id === id);
    if (!acc) return false;
    acc.name = trimmed;
    acc.updatedAt = new Date().toISOString();
    this.saveAccounts(list);
    return true;
  },

  /**
   * 删除账户及其全部数据
   * @param {string} id
   * @returns {Array} 剩余的账户列表
   */
  deleteAccount(id) {
    const list = this.getAccounts().filter(a => a.id !== id);
    this.saveAccounts(list);
    ['events', 'mileages', 'settings'].forEach(t => {
      localStorage.removeItem(this.accountKey(t, id));
    });
    if (this.getCurrentAccountId() === id) {
      this.setCurrentAccount(null);
    }
    return list;
  },

  /**
   * 生成带命名空间的 key
   * @param {string} base - events | mileages | settings
   * @param {string} [id] - 账户 id，省略则用 activeAccount
   */
  accountKey(base, id) {
    const aid = id || this.activeAccount;
    return `schedule_manager_${base}__${aid}`;
  },

  _legacyGet(key) {
    try {
      const d = localStorage.getItem(key);
      return d ? JSON.parse(d) : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * 确保至少存在一个账户；首次运行时把旧版全局数据迁移进默认账户。
   * @returns {string|null} 当前账户 id
   */
  ensureInitialized() {
    let accounts = this.getAccounts();

    if (accounts.length === 0) {
      // 迁移旧版全局数据
      const legacyEvents = this._legacyGet(this.KEYS.EVENTS_LEGACY);
      const legacyMileages = this._legacyGet(this.KEYS.MILEAGES_LEGACY);
      const legacySettings = this._legacyGet(this.KEYS.SETTINGS_LEGACY);

      const acc = this.createAccount('我的账户');

      if (Array.isArray(legacyEvents) && legacyEvents.length) {
        localStorage.setItem(this.accountKey('events', acc.id), JSON.stringify(legacyEvents));
      }
      if (Array.isArray(legacyMileages) && legacyMileages.length) {
        localStorage.setItem(this.accountKey('mileages', acc.id), JSON.stringify(legacyMileages));
      }
      if (legacySettings && typeof legacySettings === 'object' && Object.keys(legacySettings).length) {
        localStorage.setItem(this.accountKey('settings', acc.id), JSON.stringify(legacySettings));
      }

      // 清掉旧 key
      localStorage.removeItem(this.KEYS.EVENTS_LEGACY);
      localStorage.removeItem(this.KEYS.MILEAGES_LEGACY);
      localStorage.removeItem(this.KEYS.SETTINGS_LEGACY);

      accounts = this.getAccounts();
    }

    let cur = this.getCurrentAccountId();
    if (!cur || !this.getAccount(cur)) {
      cur = accounts[0] ? accounts[0].id : null;
      this.setCurrentAccount(cur);
    }
    this.activeAccount = cur;
    return cur;
  },

  // ==================== Events（按账户命名空间） ====================

  getEvents(id) {
    try {
      const data = localStorage.getItem(this.accountKey('events', id));
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load events:', e);
      return [];
    }
  },

  /**
   * 汇总所有账户的日程（用于"查看全部账户"模式）
   * 每条事件附带 _accountId / _accountName，便于跨账户编辑与展示归属
   */
  getAllEvents() {
    const all = [];
    for (const acc of this.getAccounts()) {
      const evs = this.getEvents(acc.id);
      for (const e of evs) {
        all.push({ ...e, _accountId: acc.id, _accountName: acc.name });
      }
    }
    return all;
  },

  saveEvents(events, id) {
    try {
      localStorage.setItem(this.accountKey('events', id), JSON.stringify(events));
      return true;
    } catch (e) {
      console.error('Failed to save events:', e);
      return false;
    }
  },

  addEvent(event, id) {
    const events = this.getEvents(id);
    event.id = event.id || this.generateId();
    event.createdAt = event.createdAt || new Date().toISOString();
    events.push(event);
    this.saveEvents(events, id);
    return event;
  },

  updateEvent(id, updates, accountId) {
    const events = this.getEvents(accountId);
    const idx = events.findIndex(e => e.id === id);
    if (idx >= 0) {
      events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
      this.saveEvents(events, accountId);
      return events[idx];
    }
    return null;
  },

  deleteEvent(id, accountId) {
    const events = this.getEvents(accountId).filter(e => e.id !== id);
    this.saveEvents(events, accountId);
    return true;
  },

  deleteEventsByDate(dateStr) {
    const events = this.getEvents();
    const removed = events.filter(e => e.date === dateStr);
    const kept = events.filter(e => e.date !== dateStr);
    this.saveEvents(kept);
    return removed.length;
  },

  deleteEventsByTitle(keyword) {
    if (!keyword) return 0;
    const events = this.getEvents();
    const removed = events.filter(e => e.title && e.title.indexOf(keyword) >= 0);
    const kept = events.filter(e => !e.title || e.title.indexOf(keyword) < 0);
    this.saveEvents(kept);
    return removed.length;
  },

  deleteAllEvents() {
    const count = this.getEvents().length;
    this.saveEvents([]);
    return count;
  },

  deleteEventsExceptByDate(dateStr) {
    const events = this.getEvents();
    const kept = events.filter(e => e.date === dateStr);
    const removed = events.length - kept.length;
    this.saveEvents(kept);
    return removed;
  },

  deleteEventsExceptByTitle(keyword) {
    if (!keyword) return 0;
    const events = this.getEvents();
    const kept = events.filter(e => e.title && e.title.indexOf(keyword) >= 0);
    const removed = events.length - kept.length;
    this.saveEvents(kept);
    return removed;
  },

  // ==================== Mileages（按账户命名空间） ====================

  getMileages() {
    try {
      const data = localStorage.getItem(this.accountKey('mileages'));
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load mileages:', e);
      return [];
    }
  },

  saveMileages(mileages) {
    try {
      localStorage.setItem(this.accountKey('mileages'), JSON.stringify(mileages));
      return true;
    } catch (e) {
      console.error('Failed to save mileages:', e);
      return false;
    }
  },

  addMileage(mileage) {
    const mileages = this.getMileages();
    mileage.id = mileage.id || this.generateId();
    mileage.createdAt = mileage.createdAt || new Date().toISOString();
    mileages.push(mileage);
    this.saveMileages(mileages);
    return mileage;
  },

  deleteMileage(id) {
    const mileages = this.getMileages().filter(m => m.id !== id);
    this.saveMileages(mileages);
    return true;
  },

  deleteMileagesByDate(dateStr) {
    const mileages = this.getMileages();
    const removed = mileages.filter(m => m.date === dateStr);
    const kept = mileages.filter(m => m.date !== dateStr);
    this.saveMileages(kept);
    return removed.length;
  },

  deleteAllMileages() {
    const count = this.getMileages().length;
    this.saveMileages([]);
    return count;
  },

  deleteMileagesExceptByDate(dateStr) {
    const mileages = this.getMileages();
    const kept = mileages.filter(m => m.date === dateStr);
    const removed = mileages.length - kept.length;
    this.saveMileages(kept);
    return removed;
  },

  // ==================== Settings（按账户命名空间） ====================

  getSettings() {
    try {
      const data = localStorage.getItem(this.accountKey('settings'));
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  saveSettings(settings) {
    const current = this.getSettings();
    const merged = { ...current, ...settings };
    localStorage.setItem(this.accountKey('settings'), JSON.stringify(merged));
    return merged;
  },

  // ==================== Categories（按账户命名空间，用户可自定义） ====================

  /**
   * 读取分类列表；无自定义时返回默认分类的深拷贝。
   * @param {string} [id] - 账户 id，省略则用 activeAccount
   */
  getCategories(id) {
    try {
      const data = localStorage.getItem(this.accountKey('categories', id));
      const list = data ? JSON.parse(data) : null;
      if (Array.isArray(list) && list.length) return list;
    } catch (e) {}
    return this.DEFAULT_CATEGORIES.map(c => ({ ...c, keywords: [...c.keywords] }));
  },

  /**
   * 保存分类列表。保证至少含「其他」作为兜底分类。
   * @param {Array} list - [{ name, color, keywords:[] }]
   * @param {string} [id] - 账户 id，省略则用 activeAccount
   */
  saveCategories(list, id) {
    let cats = Array.isArray(list) ? list : [];
    if (!cats.some(c => c.name === '其他')) {
      cats = [...cats, { name: '其他', color: '#6366f1', keywords: [] }];
    }
    try {
      localStorage.setItem(this.accountKey('categories', id), JSON.stringify(cats));
      return true;
    } catch (e) {
      console.error('Failed to save categories:', e);
      return false;
    }
  },

  /**
   * 读取常用地点列表（用户自定义，按账户隔离）。
   * @param {string} [id] - 账户 id，省略则用 activeAccount
   * @returns {string[]}
   */
  getLocations(id) {
    try {
      const data = localStorage.getItem(this.accountKey('locations', id));
      const list = data ? JSON.parse(data) : null;
      if (Array.isArray(list)) return list;
    } catch (e) {}
    return [];
  },

  /**
   * 保存常用地点列表（自动去重、去空白）。
   * @param {string[]} list
   * @param {string} [id] - 账户 id，省略则用 activeAccount
   */
  saveLocations(list, id) {
    const cleaned = Array.isArray(list)
      ? [...new Set(list.map(x => (x || '').trim()).filter(Boolean))]
      : [];
    try {
      localStorage.setItem(this.accountKey('locations', id), JSON.stringify(cleaned));
      return true;
    } catch (e) {
      console.error('Failed to save locations:', e);
      return false;
    }
  },

  // ==================== Import / Export ====================

  exportAllData() {
    return {
      version: '1.1',
      accountId: this.activeAccount,
      exportedAt: new Date().toISOString(),
      events: this.getEvents(),
      mileages: this.getMileages()
    };
  },

  importData(data) {
    if (!data || typeof data !== 'object') return false;
    let imported = { events: 0, mileages: 0 };

    if (Array.isArray(data.events)) {
      const existing = this.getEvents();
      const existingIds = new Set(existing.map(e => e.id));
      data.events.forEach(ev => {
        if (!existingIds.has(ev.id)) {
          existing.push(ev);
          imported.events++;
        }
      });
      this.saveEvents(existing);
    }

    if (Array.isArray(data.mileages)) {
      const existing = this.getMileages();
      const existingIds = new Set(existing.map(m => m.id));
      data.mileages.forEach(m => {
        if (!existingIds.has(m.id)) {
          existing.push(m);
          imported.mileages++;
        }
      });
      this.saveMileages(existing);
    }

    return imported;
  },

  // ==================== Utils ====================

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  },

  // 清空当前账户的事件与里程（保留账户本身）
  clearAll() {
    localStorage.removeItem(this.accountKey('events'));
    localStorage.removeItem(this.accountKey('mileages'));
  }
};

// Export to global
window.Storage = Storage;
