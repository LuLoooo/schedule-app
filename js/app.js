/**
 * app.js - Vue 主应用
 * 整合日程管理、里程记录、自然语言解析、智能排程和数据导出
 */

const { createApp } = Vue;

createApp({
  data() {
    return {
      // 模式与视图
      mode: 'schedule',          // 'schedule' | 'mileage'
      view: 'week',               // 'day' | 'week' | 'month'
      mileageView: 'week',        // 'day' | 'week' | 'month'

      // 时间轴每格高度（px），用于连续矩形定位
      hourPx: 56,
      gapPx: 18, // 折叠空白时段的高度
      // 工作时间段（分钟）：上午 8:30-11:30、下午 13:30-17:00，日/周视图高亮且始终展开
      workRanges: [[510, 690], [810, 1020]],

      // 日期导航
      currentDate: new Date(),
      mileageDate: new Date(),

      // 数据
      events: [],
      mileages: [],

      // 自然语言输入
      nlInput: '',
      parseResults: [],
      suggestions: [],

      // 事件编辑弹窗
      showEventModal: false,
      editingEvent: {},

      // 导出弹窗
      showExportModal: false,
      exportConfig: {
        range: 'week',
        weekValue: '',
        monthValue: '',
        includeSchedule: true,
        includeMileage: true,
        format: 'json'
      },
      exportPreview: null,

      // 导入弹窗
      showImportModal: false,

      // 油价设置弹窗
      showSettingsModal: false,
      oilSettings: {
        pricePerLiter: 8.0,       // 油价 元/升
        consumptionPer100km: 8.0  // 油耗 升/百公里
      },

      // Toast
      toast: { show: false, message: '', type: 'info' },

      // 颜色选项
      colorOptions: ['#6366f1', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#10b981', '#ef4444'],

      // 用户自定义分类（从 storage 读取，默认含 策划/拍摄/剪辑/摸鱼/其他）
      categories: [],
      currentCategoryFilter: 'all',

      // 分类管理弹窗
      showCategoryModal: false,
      catForm: { name: '', color: '#6366f1', keywordsText: '', oldName: null },
      categoryError: '',

      // 用户自定义常用地点（从 storage 读取，默认空）
      locations: [],

      // 常用地点管理弹窗
      showLocationModal: false,
      locForm: { name: '' },
      locError: '',

      // 常用地点改名（弹窗内联编辑）
      locEditName: '',
      locEditValue: '',

      // 事件弹窗地点下拉 - 新增地点内联输入
      showAddLocInput: false,
      newLocInput: '',

      // 事件弹窗分类下拉 - 新增分类内联输入
      showAddCatInput: false,
      newCatInput: '',

      // 删除分类弹窗（让用户选择把该分类下的日程归到哪一类）
      showDeleteCategoryModal: false,
      deletingCategory: null,
      reassignTarget: '其他',

      // 视图范围：'current' 只看当前账户 / 'all' 汇总所有账户
      viewScope: 'current',

      // 暴露 NLP 对象给模板（分类色板 CATEGORY_COLORS 等在模板中使用）
      NLP: typeof window !== 'undefined' ? window.NLP : null,

      // ==================== 账户 ====================
      currentAccountId: null,
      currentAccountName: '',
      showLogin: false,           // 全屏选账户界面
      showAccountModal: false,    // 切换账户弹窗
      accountList: [],
      newAccountName: '',
      accountError: '',

      // 重命名账户
      renamingId: null,
      renameValue: '',
      renameError: '',

      // PWA 安装
      deferredPrompt: null,
      showInstallBtn: false
    };
  },

  computed: {
    nlPlaceholder() {
      return '告诉我你的安排… 例：明天下午2点去南山拍摄，开了35公里';
    },

    // 每公里油费 = 油价 × 油耗 / 100
    costPerKm() {
      return this.oilSettings.pricePerLiter * this.oilSettings.consumptionPer100km / 100;
    },

    // ==================== Schedule Computed ====================

    // 分类筛选条选项：固定「全部」+ 动态分类列表
    categoryFilterOptions() {
      return [
        { key: 'all', label: '全部' },
        ...this.categories.map(c => ({ key: c.name, label: c.name }))
      ];
    },

    currentDateLabel() {
      const d = this.currentDate;
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      if (this.view === 'day') {
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
      } else if (this.view === 'week') {
        const start = this.getWeekStart(d);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
      } else {
        return `${d.getFullYear()}年${d.getMonth() + 1}月`;
      }
    },

    weekDays() {
      const start = this.getWeekStart(this.currentDate);
      const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const days = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        days.push({
          date: date,
          weekdayShort: weekdays[i]
        });
      }
      return days;
    },

    // 日视图：把当天事件按时间定位成连续矩形（同行程只占一个矩形，无箭头）
    dayPositioned() {
      return this.layoutEvents(this.getDayEvents(this.currentDate));
    },

    // 周视图：每一天各自做连续矩形定位
    weekPositioned() {
      return this.weekDays.map(d => this.layoutEvents(this.getDayEvents(d.date)));
    },

    // 日视图分段时间轴：有日程的小时展开，空白时段折叠
    daySegments() {
      return this.buildSegments([this.dayPositioned]);
    },
    dayTotalPx() {
      return this.segmentsTotalPx(this.daySegments);
    },

    // 周视图分段时间轴：取 7 天日程的并集
    weekSegments() {
      return this.buildSegments(this.weekPositioned);
    },
    weekTotalPx() {
      return this.segmentsTotalPx(this.weekSegments);
    },

    // 工作时间高亮带（沿分段轴映射为像素区间）
    dayWorkBands() {
      return this.buildWorkBands(this.daySegments);
    },
    weekWorkBands() {
      return this.buildWorkBands(this.weekSegments);
    },

    monthDays() {
      const year = this.currentDate.getFullYear();
      const month = this.currentDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      // 获取当月第一天是星期几（调整为周一=0）
      let firstWeekday = firstDay.getDay() - 1;
      if (firstWeekday < 0) firstWeekday = 6;

      const days = [];

      // 上个月的填充天
      for (let i = 0; i < firstWeekday; i++) {
        const date = new Date(year, month, -firstWeekday + i + 1);
        days.push({ date: date, currentMonth: false, events: this.getDayEvents(date) });
      }

      // 当月的天
      for (let i = 1; i <= lastDay.getDate(); i++) {
        const date = new Date(year, month, i);
        days.push({ date: date, currentMonth: true, events: this.getDayEvents(date) });
      }

      // 下个月的填充天
      const remaining = 7 - (days.length % 7);
      if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) {
          const date = new Date(year, month + 1, i);
          days.push({ date: date, currentMonth: false, events: this.getDayEvents(date) });
        }
      }

      return days;
    },

    filteredEvents() {
      if (this.view === 'day') {
        const dateStr = this.formatDate(this.currentDate);
        return this.events.filter(e => e.date === dateStr);
      } else if (this.view === 'week') {
        const start = this.formatDate(this.getWeekStart(this.currentDate));
        const end = new Date(this.getWeekStart(this.currentDate));
        end.setDate(end.getDate() + 6);
        const endStr = this.formatDate(end);
        return this.events.filter(e => e.date >= start && e.date <= endStr);
      } else {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const start = this.formatDate(new Date(year, month, 1));
        const end = this.formatDate(new Date(year, month + 1, 0));
        return this.events.filter(e => e.date >= start && e.date <= end);
      }
    },

    // ==================== Mileage Computed ====================

    mileageDateLabel() {
      const d = this.mileageDate;
      if (this.mileageView === 'day') {
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
      } else if (this.mileageView === 'week') {
        const start = this.getWeekStart(d);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
      } else {
        return `${d.getFullYear()}年${d.getMonth() + 1}月`;
      }
    },

    filteredMileages() {
      if (this.mileageView === 'day') {
        const dateStr = this.formatDate(this.mileageDate);
        return this.mileages.filter(m => m.date === dateStr);
      } else if (this.mileageView === 'week') {
        const start = this.formatDate(this.getWeekStart(this.mileageDate));
        const end = new Date(this.getWeekStart(this.mileageDate));
        end.setDate(end.getDate() + 6);
        const endStr = this.formatDate(end);
        return this.mileages.filter(m => m.date >= start && m.date <= endStr);
      } else {
        const year = this.mileageDate.getFullYear();
        const month = this.mileageDate.getMonth();
        const start = this.formatDate(new Date(year, month, 1));
        const end = this.formatDate(new Date(year, month + 1, 0));
        return this.mileages.filter(m => m.date >= start && m.date <= end);
      }
    },

    mileageStats() {
      const mileages = this.filteredMileages;
      const totalKm = mileages.reduce((sum, m) => sum + m.km, 0);
      const locations = new Set(mileages.map(m => m.location));
      const maxKm = mileages.length > 0 ? Math.max(...mileages.map(m => m.km)) : 0;

      // 计算天数
      let dayCount = 1;
      if (this.mileageView === 'week') dayCount = 7;
      else if (this.mileageView === 'month') {
        const d = this.mileageDate;
        dayCount = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      }

      let periodLabel = '当日';
      if (this.mileageView === 'week') periodLabel = '本周';
      if (this.mileageView === 'month') periodLabel = '本月';

      return {
        totalKm: totalKm.toFixed(1),
        avgKm: (totalKm / dayCount).toFixed(1),
        locationCount: locations.size,
        maxKm: maxKm.toFixed(1),
        totalCost: (totalKm * this.costPerKm).toFixed(2),
        periodLabel
      };
    },

    mileageChartData() {
      const data = [];
      if (this.mileageView === 'day') {
        // 日视图：按每条记录展示
        const mileages = this.filteredMileages;
        const maxKm = Math.max(...mileages.map(m => m.km), 1);
        if (mileages.length === 0) {
          data.push({ label: '今日', km: '0.0', percent: 0 });
        } else {
          mileages.forEach(m => {
            data.push({
              label: m.location,
              km: m.km.toFixed(1),
              percent: (m.km / maxKm) * 100
            });
          });
        }
      } else if (this.mileageView === 'week') {
        const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
        const start = this.getWeekStart(this.mileageDate);
        const maxKm = Math.max(...this.filteredMileages.map(m => m.km), 1);
        for (let i = 0; i < 7; i++) {
          const date = new Date(start);
          date.setDate(date.getDate() + i);
          const dateStr = this.formatDate(date);
          const km = this.filteredMileages
            .filter(m => m.date === dateStr)
            .reduce((sum, m) => sum + m.km, 0);
          data.push({ label: `周${weekdays[i]}`, km: km.toFixed(1), percent: (km / maxKm) * 100 });
        }
      } else {
        // 月视图 - 每日
        const year = this.mileageDate.getFullYear();
        const month = this.mileageDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const maxKm = Math.max(...this.filteredMileages.map(m => m.km), 1);
        for (let i = 1; i <= daysInMonth; i++) {
          const dateStr = this.formatDate(new Date(year, month, i));
          const km = this.filteredMileages
            .filter(m => m.date === dateStr)
            .reduce((sum, m) => sum + m.km, 0);
          data.push({ label: `${i}`, km: km.toFixed(1), percent: (km / maxKm) * 100 });
        }
      }
      return data;
    }
  },

  watch: {
    exportConfig: {
      deep: true,
      handler() {
        this.updateExportPreview();
      }
    }
  },

  methods: {
    // ==================== Init ====================

    init() {
      // 确保存在账户，并把旧版全局数据迁移进默认账户
      const accId = Storage.ensureInitialized();
      this.currentAccountId = accId;
      const acc = Storage.getAccount(accId);
      this.currentAccountName = acc ? acc.name : '';
      this.accountList = Storage.getAccounts();

      this.events = this.loadEvents();
      this.mileages = Storage.getMileages();

      // 加载油价设置（按账户隔离）
      const settings = Storage.getSettings();
      if (settings.oilSettings) {
        this.oilSettings = { ...this.oilSettings, ...settings.oilSettings };
      }

      // 初始化导出周/月值
      const today = new Date();
      const weekNum = this.getWeekNumber(today);
      this.exportConfig.weekValue = `${today.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      this.exportConfig.monthValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

      // 多账户时打开即显示选账户界面；单账户或无当前账户时自动进入
      this.showLogin = !accId || this.accountList.length > 1;
    },

    // ==================== 账户 ====================

    openAccountModal() {
      this.accountList = Storage.getAccounts();
      this.newAccountName = '';
      this.accountError = '';
      this.renamingId = null;
      this.renameValue = '';
      this.renameError = '';
      this.showAccountModal = true;
    },

    closeAccountModal() {
      this.showAccountModal = false;
    },

    // 从登录界面进入账户
    enterAccount(id) {
      this.renamingId = null;
      this.renameValue = '';
      this.renameError = '';
      this.switchAccount(id);
      this.showLogin = false;
    },

    // 切换账户并重新加载该账户的数据
    switchAccount(id) {
      if (!id) return;
      this.viewScope = 'current'; // 切换账户后回到只看本账户
      Storage.setCurrentAccount(id);
      this.currentAccountId = id;
      const acc = Storage.getAccount(id);
      this.currentAccountName = acc ? acc.name : '';
      this.reloadAccountData();
      this.accountList = Storage.getAccounts();
      this.showAccountModal = false;
      this.showToast('已切换到账户：' + (acc ? acc.name : ''), 'success');
    },

    // 新建账户（建好后直接进入，内容为空）
    createAccount() {
      const name = (this.newAccountName || '').trim();
      if (!name) {
        this.accountError = '请输入账户名称';
        return;
      }
      const acc = Storage.createAccount(name);
      this.newAccountName = '';
      this.accountError = '';
      this.switchAccount(acc.id);
    },

    // 开始重命名（进入编辑态）
    startRename(id, name) {
      this.renamingId = id;
      this.renameValue = name || '';
      this.renameError = '';
    },

    // 保存重命名
    saveRename() {
      const name = (this.renameValue || '').trim();
      if (!name) {
        this.renameError = '名称不能为空';
        return;
      }
      const ok = Storage.renameAccount(this.renamingId, name);
      if (!ok) {
        this.renameError = '重命名失败';
        return;
      }
      // 若改的是当前账户，同步更新顶部显示名
      if (this.renamingId === this.currentAccountId) {
        this.currentAccountName = name;
      }
      this.accountList = Storage.getAccounts();
      this.renamingId = null;
      this.renameValue = '';
      this.renameError = '';
      this.showToast('已重命名为：' + name, 'success');
    },

    // 取消重命名
    cancelRename() {
      this.renamingId = null;
      this.renameValue = '';
      this.renameError = '';
    },

    // 删除账户（连带数据一并删除）
    deleteAccount(id) {
      const acc = Storage.getAccount(id);
      const name = acc ? acc.name : '该账户';
      if (!confirm(`确定删除账户「${name}」吗？该账户下的所有日程和里程将一并删除，且不可恢复！`)) return;
      Storage.deleteAccount(id);
      this.accountList = Storage.getAccounts();
      const cur = Storage.getCurrentAccountId();
      if (cur) {
        this.switchAccount(cur);
      } else {
        // 没有账户了，回到登录界面
        this.currentAccountId = null;
        this.currentAccountName = '';
        this.events = [];
        this.mileages = [];
        this.oilSettings = { pricePerLiter: 8.0, consumptionPer100km: 8.0 };
        this.showAccountModal = false;
        this.showLogin = true;
      }
    },

    // 退出登录（回到选账户界面）
    logout() {
      Storage.setCurrentAccount(null);
      this.currentAccountId = null;
      this.currentAccountName = '';
      this.accountList = Storage.getAccounts();
      this.renamingId = null;
      this.renameValue = '';
      this.renameError = '';
      this.showAccountModal = false;
      this.showLogin = true;
    },

    // 根据视图范围加载事件：当前账户 or 全部账户汇总
    loadEvents() {
      if (this.viewScope === 'all') return Storage.getAllEvents();
      return Storage.getEvents();
    },

    // 切换视图范围（只看本账户 / 查看全部账户）
    setViewScope(scope) {
      this.viewScope = scope;
      this.events = this.loadEvents();
    },

    // 重新加载当前账户的事件/里程/油价设置
    reloadAccountData() {
      this.events = this.loadEvents();
      this.mileages = Storage.getMileages();
      const def = { pricePerLiter: 8.0, consumptionPer100km: 8.0 };
      const settings = Storage.getSettings();
      this.oilSettings = settings.oilSettings ? { ...def, ...settings.oilSettings } : { ...def };
      // 加载本账户自定义分类并同步给 NLP（影响自动归类与标题归纳）
      this.categories = Storage.getCategories();
      if (window.NLP) NLP.setCategories(this.categories);
      // 加载本账户常用地点
      this.locations = Storage.getLocations();
      if (window.NLP) NLP.setLocations(this.locations);
    },

    // 账户头像颜色（按名称哈希取色板）
    accountColor(name) {
      const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#3b82f6', '#ef4444', '#10b981'];
      let h = 0;
      const s = name || '';
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return palette[h % palette.length];
    },

    // ==================== Natural Language ====================

    fillHint(text) {
      this.nlInput = text;
    },

    parseNaturalLanguage() {
      const input = this.nlInput.trim();
      if (!input) {
        this.showToast('请输入内容', 'error');
        return;
      }

      const results = NLP.parse(input, new Date());

      if (results.length === 0) {
        this.showToast('未能解析输入内容，请尝试其他表述', 'error');
        return;
      }

      // 分类处理：suggestion / 添加类 / 删除类
      const suggestions = results.filter(r => r.type === 'suggestion');
      const addables = results.filter(r => r.type === 'schedule' || r.type === 'mileage');
      const deletes = results.filter(r => r.type === 'delete');

      // 1. 添加类立即执行
      let scheduleAdded = 0;
      let mileageAdded = 0;
      for (const r of addables) {
        if (r.type === 'schedule') {
          Storage.addEvent({
            title: r.title,
            category: r.category || '其他',
            date: r.date,
            startTime: r.startTime,
            endTime: r.endTime,
            allDay: r.allDay,
            location: r.location,
            color: r.color,
            description: r.description || ''
          });
          scheduleAdded++;
        } else if (r.type === 'mileage') {
          Storage.addMileage({
            date: r.date,
            location: r.location,
            km: r.km,
            notes: r.notes
          });
          mileageAdded++;
        }
      }

      // 1.5 说话里解析出的地点自动存入常用地点（下次直接下拉可选、说到即命中）
      this.autoSaveParsedLocations(addables);

      // 2. 删除类立即执行（危险操作 executeDelete 内部仍 confirm 兜底）
      let deleteCount = 0;
      let deleteCanceled = false;
      for (const r of deletes) {
        if (this.executeDelete(r)) {
          deleteCount++;
        } else {
          deleteCanceled = true;
        }
      }

      // 3. 建议类：查找空闲时段展示供选择
      if (suggestions.length > 0) {
        for (const s of suggestions) {
          const slots = Scheduler.findFreeSlots(this.events, s.duration, new Date(), 14);
          this.suggestions = slots;
        }
        if (this.suggestions.length === 0) {
          this.showToast('未能找到合适的空闲时段', 'error');
        }
      }

      // 刷新数据
      this.events = this.loadEvents();
      this.mileages = Storage.getMileages();
      this.parseResults = [];

      // 4. 汇总提示
      const parts = [];
      if (scheduleAdded > 0) parts.push(`添加 ${scheduleAdded} 条日程`);
      if (mileageAdded > 0) parts.push(`添加 ${mileageAdded} 条里程`);
      if (deleteCount > 0) parts.push(`执行 ${deleteCount} 项删除`);
      if (deleteCanceled) parts.push('有删除被取消');
      if (suggestions.length > 0 && this.suggestions.length > 0) parts.push(`找到 ${this.suggestions.length} 个空闲时段`);

      if (parts.length > 0) {
        this.showToast('已完成：' + parts.join('，'), 'success');
      } else if (suggestions.length === 0 && addables.length === 0 && deletes.length === 0) {
        this.showToast('未能识别操作', 'error');
      }

      this.nlInput = '';
    },

    confirmResult(result, index) {
      if (result.type === 'schedule') {
        const event = {
          title: result.title,
          category: result.category || '其他',
          date: result.date,
          startTime: result.startTime,
          endTime: result.endTime,
          allDay: result.allDay,
          location: result.location,
          color: result.color,
          description: result.description || ''
        };
        Storage.addEvent(event);
        this.autoSaveParsedLocations([result]);
        this.events = this.loadEvents();
        this.showToast('已添加日程：' + result.title, 'success');
        this.parseResults.splice(index, 1);
      } else if (result.type === 'mileage') {
        const mileage = {
          date: result.date,
          location: result.location,
          km: result.km,
          notes: result.notes
        };
        Storage.addMileage(mileage);
        this.mileages = Storage.getMileages();
        this.showToast('已添加里程：' + result.location + ' ' + result.km + 'km', 'success');
        this.parseResults.splice(index, 1);
      } else if (result.type === 'delete') {
        // 执行删除，失败（用户取消）则不移除
        const ok = this.executeDelete(result);
        if (ok) {
          this.parseResults.splice(index, 1);
        }
      }
    },

    /**
     * 执行删除操作
     * @returns {boolean} 是否执行成功（用户取消则返回 false）
     */
    executeDelete(result) {
      let deleted = 0;
      let msg = '';
      switch (result.scope) {
        case 'all_events':
          if (!confirm('确定要清空所有日程及对应里程吗？此操作不可恢复！')) return false;
          deleted = Storage.deleteAllEvents();
          {
            const mDel = Storage.deleteAllMileages();
            msg = `已清空 ${deleted} 条日程` + (mDel > 0 ? ` + ${mDel} 条里程` : '');
          }
          break;
        case 'all_mileages':
          if (!confirm('确定要清空所有里程记录吗？此操作不可恢复！')) return false;
          deleted = Storage.deleteAllMileages();
          msg = deleted > 0 ? `已清空 ${deleted} 条里程` : '当前没有里程可删除';
          break;
        case 'all_data':
          if (!confirm('确定要清空所有数据（日程+里程）吗？此操作不可恢复！')) return false;
          const eCount = Storage.deleteAllEvents();
          const mCount = Storage.deleteAllMileages();
          msg = `已清空 ${eCount} 条日程 + ${mCount} 条里程`;
          break;
        case 'date_events':
          deleted = Storage.deleteEventsByDate(result.date);
          {
            const mDel = Storage.deleteMileagesByDate(result.date);
            msg = `已删除${result.dateLabel}的 ${deleted} 条日程` + (mDel > 0 ? ` + ${mDel} 条里程` : '');
          }
          break;
        case 'date_mileages':
          deleted = Storage.deleteMileagesByDate(result.date);
          msg = deleted > 0 ? `已删除${result.dateLabel}的 ${deleted} 条里程` : `${result.dateLabel}没有里程`;
          break;
        case 'title_events':
          deleted = Storage.deleteEventsByTitle(result.keyword);
          msg = deleted > 0 ? `已删除 ${deleted} 条含「${result.keyword}」的日程` : `未找到含「${result.keyword}」的日程`;
          break;
        case 'except_date_events':
          if (!confirm(`确定要删除除${result.dateLabel}以外的所有日程及里程吗？此操作不可恢复！`)) return false;
          deleted = Storage.deleteEventsExceptByDate(result.date);
          {
            const mDel = Storage.deleteMileagesExceptByDate(result.date);
            msg = `已删除 ${deleted} 条日程` + (mDel > 0 ? ` + ${mDel} 条里程` : '') + `（保留了${result.dateLabel}的）`;
          }
          break;
        case 'except_date_mileages':
          if (!confirm(`确定要删除除${result.dateLabel}以外的所有里程吗？此操作不可恢复！`)) return false;
          deleted = Storage.deleteMileagesExceptByDate(result.date);
          msg = deleted > 0 ? `已删除 ${deleted} 条里程（保留了${result.dateLabel}的）` : '没有需要删除的里程';
          break;
        case 'except_title_events':
          if (!confirm(`确定要删除除含「${result.keyword}」以外的所有日程吗？此操作不可恢复！`)) return false;
          deleted = Storage.deleteEventsExceptByTitle(result.keyword);
          msg = deleted > 0 ? `已删除 ${deleted} 条日程（保留了含「${result.keyword}」的）` : '没有需要删除的日程';
          break;
        default:
          return false;
      }
      this.events = this.loadEvents();
      this.mileages = Storage.getMileages();
      this.showToast(msg, 'success');
      return true;
    },

    confirmAllResults() {
      let scheduleAdded = 0;
      let mileageAdded = 0;
      let deleteCount = 0;

      for (const result of [...this.parseResults]) {
        if (result.type === 'schedule') {
          Storage.addEvent({
            title: result.title,
            date: result.date,
            startTime: result.startTime,
            endTime: result.endTime,
            allDay: result.allDay,
            location: result.location,
            color: result.color,
            description: result.description || ''
          });
          scheduleAdded++;
        } else if (result.type === 'mileage') {
          Storage.addMileage({
            date: result.date,
            location: result.location,
            km: result.km,
            notes: result.notes
          });
          mileageAdded++;
        } else if (result.type === 'delete') {
          // 批量确认时，对危险操作（全部删除）仍做二次确认
          if (this.executeDelete(result)) {
            deleteCount++;
          }
        }
      }

      this.autoSaveParsedLocations(this.parseResults);
      this.events = this.loadEvents();
      this.mileages = Storage.getMileages();

      // 只清掉已成功处理的；delete 若被用户取消则保留
      this.parseResults = this.parseResults.filter(r => {
        if (r.type === 'delete') {
          // 简化处理：批量确认时，保留被取消的 delete 项较复杂
          // 这里统一清空（因为 executeDelete 内部已处理取消逻辑）
          return false;
        }
        return false; // schedule/mileage 已添加，清掉
      });

      // 拼接提示
      const parts = [];
      if (scheduleAdded > 0) parts.push(`${scheduleAdded} 条日程`);
      if (mileageAdded > 0) parts.push(`${mileageAdded} 条里程`);
      if (deleteCount > 0) parts.push(`${deleteCount} 项删除`);
      if (parts.length > 0) {
        this.showToast('已完成：' + parts.join(' + '), 'success');
      }
    },

    acceptSuggestion(suggestion) {
      const event = {
        title: this.suggestions.length > 0 ? this.parseResults.find(r => r.type === 'suggestion')?.title || '已安排任务' : '已安排任务',
        date: suggestion.date,
        startTime: suggestion.start,
        endTime: suggestion.end,
        location: '',
        color: '#6366f1',
        description: '由智能排程安排'
      };

      // 获取建议标题
      const suggestionResult = this.parseResults.find(r => r.type === 'suggestion');
      if (suggestionResult) {
        event.title = suggestionResult.title;
        event.color = NLP.assignColor(suggestionResult.title);
      }

      Storage.addEvent(event);
      this.events = this.loadEvents();
      this.suggestions = [];
      this.parseResults = this.parseResults.filter(r => r.type !== 'suggestion');
      this.showToast(`已安排：${event.title} → ${suggestion.dateLabel} ${suggestion.start}`, 'success');
    },

    // ==================== Calendar Navigation ====================

    navigateDate(direction) {
      const d = new Date(this.currentDate);
      if (this.view === 'day') {
        d.setDate(d.getDate() + direction);
      } else if (this.view === 'week') {
        d.setDate(d.getDate() + direction * 7);
      } else {
        d.setMonth(d.getMonth() + direction);
      }
      this.currentDate = d;
    },

    navigateMileageDate(direction) {
      const d = new Date(this.mileageDate);
      if (this.mileageView === 'day') {
        d.setDate(d.getDate() + direction);
      } else if (this.mileageView === 'week') {
        d.setDate(d.getDate() + direction * 7);
      } else {
        d.setMonth(d.getMonth() + direction);
      }
      this.mileageDate = d;
    },

    goToday() {
      this.currentDate = new Date();
    },

    selectDay(date) {
      this.currentDate = new Date(date);
      this.view = 'day';
    },

    // ==================== Event Helpers ====================

    getEventsAtHour(date, hour) {
      const dateStr = this.formatDate(date);
      return this.events.filter(e => {
        if (e.date !== dateStr) return false;
        if (this.currentCategoryFilter !== 'all' && e.category !== this.currentCategoryFilter) return false;
        if (e.allDay) return hour === 0;
        const startHour = parseInt(e.startTime.split(':')[0]);
        const parts = e.endTime.split(':');
        const endHour = parseInt(parts[0]);
        const endMin = parseInt(parts[1]) || 0;
        // 事件覆盖 [startHour, endHour]；endMin>0 时 endHour 也算覆盖
        const lastCovered = endMin > 0 ? endHour : endHour - 1;
        return hour >= startHour && hour <= lastCovered;
      }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    },

    // 判断事件是否在该小时格子"开始"（用于区分完整卡片 vs 延续条）
    isEventStartAtHour(ev, hour) {
      if (ev.allDay) return hour === 0;
      return parseInt(ev.startTime.split(':')[0]) === hour;
    },

    getDayEvents(date) {
      const dateStr = this.formatDate(date);
      return this.events
        .filter(e => e.date === dateStr && (this.currentCategoryFilter === 'all' || e.category === this.currentCategoryFilter))
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    },

    // 把事件布局成连续矩形：计算每个事件的 top/height（px）与重叠时的 left/width（%）
    layoutEvents(events) {
      const H = this.hourPx;
      const list = events.map(e => {
        let sh = 9, sm = 0, eh = 10, em = 0;
        if (e.startTime && e.startTime.indexOf(':') > -1) {
          const p = e.startTime.split(':');
          sh = parseInt(p[0]) || 0; sm = parseInt(p[1]) || 0;
        }
        if (e.endTime && e.endTime.indexOf(':') > -1) {
          const p = e.endTime.split(':');
          eh = parseInt(p[0]) || 0; em = parseInt(p[1]) || 0;
        }
        let start = sh * 60 + sm;
        let end = eh * 60 + em;
        if (end <= start) end = start + 60; // 兜底：至少 1 小时
        return { ...e, _start: start, _end: end, _top: start / 60 * H, _height: (end - start) / 60 * H };
      });
      // 重叠分组 + 等宽分列
      const clusters = [];
      let cluster = [];
      let lastEnd = -1;
      for (const ev of list) {
        if (cluster.length && ev._start >= lastEnd) {
          clusters.push(cluster);
          cluster = [];
          lastEnd = -1;
        }
        cluster.push(ev);
        lastEnd = Math.max(lastEnd, ev._end);
      }
      if (cluster.length) clusters.push(cluster);
      for (const c of clusters) {
        const n = c.length;
        c.forEach((ev, i) => {
          ev._leftPct = i * 100 / n;
          ev._widthPct = 100 / n;
        });
      }
      return list;
    },

    // ==================== 分段时间轴（压缩无日程时段） ====================

    /**
     * 根据若干天的已定位事件，把 0-24 点切成「展开段」和「折叠段」。
     * - 有事件覆盖的小时（含前后各 1 小时缓冲）展开为正常高度
     * - 连续空白小时合并为一条极窄折叠条（gapPx 高）
     * - 完全没有事件时，默认展开 8:00-19:00
     * 返回 [{ type:'open'|'gap', from, to, top, px }]，from/to 为小时 [from, to)
     */
    buildSegments(eventLists) {
      const covered = new Array(24).fill(false);
      let has = false;
      for (const list of eventLists) {
        for (const ev of list) {
          if (ev.allDay) { covered[0] = true; has = true; continue; }
          const sh = Math.max(0, Math.floor(ev._start / 60));
          const eh = Math.min(23, Math.max(sh, Math.ceil(ev._end / 60) - 1));
          for (let h = sh; h <= eh; h++) covered[h] = true;
          has = true;
        }
      }
      if (!has) {
        for (let h = 8; h < 19; h++) covered[h] = true;
      }
      // 前后各留 1 小时缓冲，方便点击空白快速添加
      const open = covered.slice();
      for (let h = 0; h < 24; h++) {
        if (covered[h]) {
          if (h > 0) open[h - 1] = true;
          if (h < 23) open[h + 1] = true;
        }
      }
      // 工作时间段始终展开（保证高亮带可见）
      for (const [ws, we] of this.workRanges) {
        const fromH = Math.floor(ws / 60);
        const toH = Math.min(23, Math.ceil(we / 60) - 1);
        for (let wh = fromH; wh <= toH; wh++) open[wh] = true;
      }
      const segs = [];
      let h = 0;
      while (h < 24) {
        const isOpen = open[h];
        let end = h;
        while (end < 24 && open[end] === isOpen) end++;
        segs.push({ type: isOpen ? 'open' : 'gap', from: h, to: end });
        h = end;
      }
      let y = 0;
      for (const s of segs) {
        s.top = y;
        s.px = s.type === 'open' ? (s.to - s.from) * this.hourPx : this.gapPx;
        y += s.px;
      }
      return segs;
    },

    // 工作时间段 → 高亮带像素区间（标签如 08:30 ~ 11:30）
    buildWorkBands(segs) {
      const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      return this.workRanges.map(([ws, we]) => {
        const top = this.minutesToY(ws, segs);
        const height = Math.max(0, this.minutesToY(we, segs) - top);
        return { top, height, label: fmt(ws) + ' ~ ' + fmt(we) + ' 工作时间' };
      }).filter(b => b.height > 4);
    },

    segmentsTotalPx(segs) {
      if (!segs.length) return 24 * this.hourPx;
      const last = segs[segs.length - 1];
      return last.top + last.px;
    },

    // 分钟（0-1440）→ 像素 Y（沿分段轴）
    minutesToY(min, segs) {
      for (const s of segs) {
        const sMin = s.from * 60, eMin = s.to * 60;
        if (min < sMin) return s.top;
        if (min < eMin) {
          if (s.type === 'gap') return s.top + (min - sMin) / (eMin - sMin) * s.px;
          return s.top + (min - sMin) / 60 * this.hourPx;
        }
      }
      const last = segs[segs.length - 1];
      return last ? last.top + last.px : min / 60 * this.hourPx;
    },

    // 像素 Y → 小时（用于点击空白快速添加）
    yToHour(y, segs) {
      for (const s of segs) {
        if (y < s.top + s.px) {
          if (s.type === 'gap') return s.from;
          return Math.min(23, s.from + Math.floor((y - s.top) / this.hourPx));
        }
      }
      return 23;
    },

    // 折叠条上显示的时间范围文本
    gapLabel(seg) {
      const f = String(seg.from).padStart(2, '0');
      const t = seg.to >= 24 ? '24' : String(seg.to).padStart(2, '0');
      return f + ':00 ~ ' + t + ':00';
    },

    dayEventStyle(ev) {
      if (ev.allDay) {
        return {
          top: '2px', height: '22px', left: '2px', width: 'calc(100% - 4px)',
          backgroundColor: ev.color + '22', borderLeftColor: ev.color
        };
      }
      const top = this.minutesToY(ev._start, this.daySegments);
      const height = Math.max(20, this.minutesToY(ev._end, this.daySegments) - top);
      return {
        top: top + 'px',
        height: height + 'px',
        left: 'calc(' + ev._leftPct + '% + 2px)',
        width: 'calc(' + ev._widthPct + '% - 4px)',
        backgroundColor: ev.color + '18',
        borderLeftColor: ev.color
      };
    },

    weekEventStyle(ev) {
      if (ev.allDay) {
        return {
          top: '2px', height: '20px', left: '1px', width: 'calc(100% - 2px)',
          backgroundColor: ev.color + '28', borderLeftColor: ev.color, color: ev.color
        };
      }
      const top = this.minutesToY(ev._start, this.weekSegments);
      const height = Math.max(16, this.minutesToY(ev._end, this.weekSegments) - top);
      return {
        top: top + 'px',
        height: height + 'px',
        left: 'calc(' + ev._leftPct + '% + 1px)',
        width: 'calc(' + ev._widthPct + '% - 2px)',
        backgroundColor: ev.color + '22',
        borderLeftColor: ev.color,
        color: ev.color
      };
    },

    // 日视图空白处点击：按 Y 坐标沿分段轴反算小时，快速新建
    dayQuickAdd(e, date) {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const hour = this.yToHour(y, this.daySegments);
      this.quickAddEvent(date, hour);
    },

    // 周视图某天空白处点击：按 Y 坐标沿分段轴反算小时，快速新建
    weekQuickAdd(e, date) {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const hour = this.yToHour(y, this.weekSegments);
      this.quickAddEvent(date, hour);
    },

    installApp() {
      if (!this.deferredPrompt) return;
      this.deferredPrompt.prompt();
      const p = this.deferredPrompt;
      this.deferredPrompt = null;
      this.showInstallBtn = false;
      (p.userChoice || Promise.resolve()).catch(() => {});
    },

    // ==================== Event Modal ====================

    editEvent(event) {
      this.editingEvent = {
        ...event,
        dateStr: event.date,
        category: event.category || '其他',
        id: event.id
      };
      this._lastCategory = this.editingEvent.category;
      this.showAddCatInput = false;
      this.newCatInput = '';
      this.showEventModal = true;
    },

    // 编辑弹窗切换分类时，自动套用分类色（其他类保留手动颜色）
    onCategoryChange() {
      const cat = this.editingEvent.category;
      if (cat && cat !== '其他' && window.NLP && window.NLP.CATEGORY_COLORS[cat]) {
        this.editingEvent.color = window.NLP.CATEGORY_COLORS[cat];
      }
    },

    // 事件弹窗分类下拉：选到「➕ 新增分类…」时展开内联输入
    onCategorySelect() {
      if (this.editingEvent.category === '__add_new_cat__') {
        this.showAddCatInput = true;
        this.newCatInput = '';
      } else {
        this._lastCategory = this.editingEvent.category;
        this.showAddCatInput = false;
        this.onCategoryChange();
      }
    },

    // 弹窗内确认新增分类：创建 + 持久化 + 同步 NLP + 选中
    confirmAddCategory() {
      const name = (this.newCatInput || '').trim();
      if (!name) { this.showToast('请输入分类名称', 'error'); return; }
      if (name === '全部' || name === '__add_new_cat__') { this.showToast('该名称不可用', 'error'); return; }
      if (this.categories.some(c => c.name === name)) {
        this.editingEvent.category = name;
        this._lastCategory = name;
        this.showAddCatInput = false;
        this.newCatInput = '';
        this.onCategoryChange();
        this.showToast('该分类已存在，已为你选中', 'info');
        return;
      }
      const color = this._randomCategoryColor();
      const list = this.categories.map(c => ({ ...c, keywords: [...(c.keywords || [])] }));
      list.push({ name, color, keywords: [name] });
      Storage.saveCategories(list);
      this.categories = Storage.getCategories();
      if (window.NLP) NLP.setCategories(this.categories);
      this.editingEvent.category = name;
      this.editingEvent.color = color;
      this._lastCategory = name;
      this.showAddCatInput = false;
      this.newCatInput = '';
      this.showToast('分类「' + name + '」已添加并选中', 'success');
    },

    cancelAddCategory() {
      this.showAddCatInput = false;
      this.newCatInput = '';
      if (this.editingEvent.category === '__add_new_cat__') {
        this.editingEvent.category = this._lastCategory || '其他';
      }
    },

    // ==================== 分类管理（用户自定义增删改） ====================

    openCategoryModal() {
      this.catForm = { name: '', color: this._randomCategoryColor(), keywordsText: '', oldName: null };
      this.categoryError = '';
      this.showCategoryModal = true;
    },

    editCategory(cat) {
      this.catForm = {
        name: cat.name,
        color: cat.color || '#6366f1',
        keywordsText: (cat.keywords || []).join('、'),
        oldName: cat.name
      };
      this.categoryError = '';
      this.showCategoryModal = true;
    },

    _randomCategoryColor() {
      const palette = ['#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#3b82f6', '#ef4444', '#10b981', '#0ea5e9', '#a855f7', '#f43f5e'];
      return palette[Math.floor(Math.random() * palette.length)];
    },

    // 保存分类（新增或更新）
    saveCategory() {
      const name = (this.catForm.name || '').trim();
      if (!name) { this.categoryError = '请输入分类名称'; return; }
      if (name === '全部') { this.categoryError = '「全部」是保留字，不能用作分类名'; return; }
      const color = this.catForm.color || '#6366f1';
      const keywords = (this.catForm.keywordsText || '')
        .split(/[，,、\s]+/).map(k => k.trim()).filter(Boolean);
      const oldName = this.catForm.oldName;

      // 同名校验（排除自身）
      const dup = this.categories.some(c => c.name !== oldName && c.name === name);
      if (dup) { this.categoryError = '已存在同名分类'; return; }

      let list = this.categories.map(c => ({ ...c, keywords: [...(c.keywords || [])] }));
      if (oldName) {
        // 编辑：更新该分类；若改名，同步更新本账户下相关日程的分类名
        const idx = list.findIndex(c => c.name === oldName);
        if (idx >= 0) {
          list[idx] = { name, color, keywords };
        }
        if (oldName !== name) this._reassignCategoryEvents(oldName, name);
      } else {
        // 新增
        if (!list.some(c => c.name === name)) list.push({ name, color, keywords });
      }

      Storage.saveCategories(list);
      this.categories = Storage.getCategories();
      if (window.NLP) NLP.setCategories(this.categories);
      this.currentCategoryFilter = 'all';
      this.showCategoryModal = false;
      this.showToast(oldName ? '分类已更新' : '分类已添加', 'success');
    },

    // 删除分类（「其他」不可删）：先弹窗让用户选择该分类下日程归到哪一类
    deleteCategory(cat) {
      if (cat.name === '其他') return;
      this.deletingCategory = cat;
      // 默认目标：优先「其他」，否则第一个非自身分类
      const others = this.categories.filter(c => c.name !== cat.name);
      this.reassignTarget = others.some(c => c.name === '其他') ? '其他' : (others[0] ? others[0].name : '其他');
      this.showDeleteCategoryModal = true;
    },

    // 确认删除：把该分类下日程归到 reassignTarget，再删除分类
    confirmDeleteCategory() {
      const cat = this.deletingCategory;
      if (!cat) { this.showDeleteCategoryModal = false; return; }
      const target = this.reassignTarget || '其他';
      const affected = this._reassignCategoryEvents(cat.name, target);
      const list = this.categories
        .filter(c => c.name !== cat.name)
        .map(c => ({ ...c, keywords: [...(c.keywords || [])] }));
      Storage.saveCategories(list);
      this.categories = Storage.getCategories();
      if (window.NLP) NLP.setCategories(this.categories);
      this.events = this.loadEvents();
      this.currentCategoryFilter = 'all';
      this.showDeleteCategoryModal = false;
      this.deletingCategory = null;
      this.showToast(
        affected > 0
          ? `分类已删除，${affected} 条日程已归入「${target}」`
          : '分类已删除',
        'success'
      );
    },

    cancelDeleteCategory() {
      this.showDeleteCategoryModal = false;
      this.deletingCategory = null;
    },

    // 把本账户下某分类的日程改归属到另一个分类（重命名/删除时保持历史归类）
    // 同时把这些日程的颜色更新为目标分类的颜色。返回受影响的日程条数。
    _reassignCategoryEvents(fromName, toName) {
      const evs = Storage.getEvents();
      const targetCat = (this.categories || []).find(c => c.name === toName);
      const targetColor = targetCat ? targetCat.color : null;
      let count = 0;
      for (const e of evs) {
        if (e.category === fromName) {
          e.category = toName;
          if (targetColor) e.color = targetColor;
          count++;
        }
      }
      if (count > 0) Storage.saveEvents(evs);
      return count;
    },

    // ==================== 常用地点管理 ====================

    openLocationModal() {
      this.locForm = { name: '' };
      this.locError = '';
      this.showLocationModal = true;
    },

    // 说话解析出的地点自动加入常用地点（去重、同步 NLP），实现"说到哪里就归到哪里"
    autoSaveParsedLocations(results) {
      const fresh = [];
      for (const r of results || []) {
        const loc = (r && r.location || '').trim();
        if (loc && loc.length <= 12 && !this.locations.includes(loc) && !fresh.includes(loc)) {
          fresh.push(loc);
        }
      }
      if (!fresh.length) return;
      Storage.saveLocations([...this.locations, ...fresh]);
      this.locations = Storage.getLocations();
      if (window.NLP) NLP.setLocations(this.locations);
    },

    addLocation() {
      const v = (this.locForm.name || '').trim();
      if (!v) { this.locError = '请输入地点名称'; return; }
      if (this.locations.includes(v)) { this.locError = '该地点已存在'; return; }
      Storage.saveLocations([...this.locations, v]);
      this.locations = Storage.getLocations();
      if (window.NLP) NLP.setLocations(this.locations);
      this.locForm.name = '';
      this.showToast('已添加常用地点', 'success');
    },

    // 开始改名（弹窗内联编辑）
    startEditLocation(loc) {
      this.locEditName = loc;
      this.locEditValue = loc;
    },
    cancelEditLocation() {
      this.locEditName = '';
      this.locEditValue = '';
    },
    saveEditLocation() {
      const oldName = this.locEditName;
      const newName = (this.locEditValue || '').trim();
      if (!newName) { this.showToast('名称不能为空', 'error'); return; }
      if (newName !== oldName && this.locations.includes(newName)) {
        this.showToast('该地点已存在', 'error'); return;
      }
      // 更新地点列表
      const list = this.locations.map(x => x === oldName ? newName : x);
      Storage.saveLocations(list);
      this.locations = Storage.getLocations();
      if (window.NLP) NLP.setLocations(this.locations);
      // 同步引用该地点的日程与里程
      const n = Storage.renameLocationEverywhere(oldName, newName);
      if (n > 0) this.events = this.loadEvents();
      this.cancelEditLocation();
      this.showToast(n > 0 ? `已改名并同步 ${n} 条记录` : '已改名', 'success');
    },

    deleteLocation(loc) {
      if (!confirm(`从常用地点中删除「${loc}」？（不影响已有日程）`)) return;
      Storage.saveLocations(this.locations.filter(x => x !== loc));
      this.locations = Storage.getLocations();
      if (window.NLP) NLP.setLocations(this.locations);
      this.showToast('已删除', 'success');
    },

    // 事件弹窗地点下拉：选择处理
    onLocationSelect(e) {
      const val = e.target.value;
      if (val === '__add__') {
        this.editingEvent.location = '';
        this.newLocInput = '';
        this.showAddLocInput = true;
      } else {
        this.showAddLocInput = false;
      }
    },
    confirmAddLocation() {
      const v = (this.newLocInput || '').trim();
      if (!v) { this.showToast('请输入地点名称', 'error'); return; }
      if (this.locations.includes(v)) {
        this.editingEvent.location = v;
        this.showAddLocInput = false;
        this.newLocInput = '';
        this.showToast('该地点已存在', 'info');
        return;
      }
      Storage.saveLocations([...this.locations, v]);
      this.locations = Storage.getLocations();
      if (window.NLP) NLP.setLocations(this.locations);
      this.editingEvent.location = v;
      this.showAddLocInput = false;
      this.newLocInput = '';
      this.showToast('已添加并选中', 'success');
    },

    // 把当前编辑中的地点存入常用地点（去重）
    addCurrentLocationToFrequent() {
      const v = (this.editingEvent.location || '').trim();
      if (!v) { this.showToast('请先填写地点', 'error'); return; }
      if (this.locations.includes(v)) { this.showToast('已在常用地点中', 'info'); return; }
      Storage.saveLocations([...this.locations, v]);
      this.locations = Storage.getLocations();
      this.showToast('已加入常用地点', 'success');
    },

    quickAddEvent(date, hour) {
      const endTime = hour + 1 > 23 ? '23:00' : `${String(hour + 1).padStart(2, '0')}:00`;
      this.editingEvent = {
        title: '',
        category: '其他',
        dateStr: this.formatDate(date),
        startTime: `${String(hour).padStart(2, '0')}:00`,
        endTime: endTime,
        location: '',
        color: '#6366f1',
        description: ''
      };
      this.showEventModal = true;
    },

    saveEvent() {
      if (!this.editingEvent.title || !this.editingEvent.title.trim()) {
        this.showToast('请输入日程标题', 'error');
        return;
      }

      const event = {
        title: this.editingEvent.title.trim(),
        category: this.editingEvent.category || '其他',
        date: this.editingEvent.dateStr,
        startTime: this.editingEvent.startTime,
        endTime: this.editingEvent.endTime,
        location: this.editingEvent.location || '',
        color: this.editingEvent.color || '#6366f1',
        description: this.editingEvent.description || ''
      };

      const accountId = this.editingEvent._accountId || this.currentAccountId;
      if (this.editingEvent.id) {
        Storage.updateEvent(this.editingEvent.id, event, accountId);
        this.showToast('日程已更新', 'success');
      } else {
        Storage.addEvent(event, accountId);
        this.showToast('日程已添加', 'success');
      }

      this.events = this.loadEvents();
      this.showEventModal = false;
    },

    deleteEvent(id) {
      if (confirm('确定要删除这个日程吗？')) {
        const ev = this.events.find(e => e.id === id);
        const accountId = ev ? ev._accountId : undefined;
        Storage.deleteEvent(id, accountId);
        this.events = this.loadEvents();
        this.showEventModal = false;
        this.showToast('日程已删除', 'success');
      }
    },

    // ==================== Mileage ====================

    deleteMileage(id) {
      if (confirm('确定要删除这条里程记录吗？')) {
        Storage.deleteMileage(id);
        this.mileages = Storage.getMileages();
        this.showToast('里程记录已删除', 'success');
      }
    },

    // 计算单条里程的花费
    calcMileageCost(km) {
      return (km * this.costPerKm).toFixed(2);
    },

    // 保存油价设置
    saveOilSettings() {
      const p = parseFloat(this.oilSettings.pricePerLiter);
      const c = parseFloat(this.oilSettings.consumptionPer100km);
      if (isNaN(p) || p <= 0) {
        this.showToast('请输入有效的油价', 'error');
        return;
      }
      if (isNaN(c) || c <= 0) {
        this.showToast('请输入有效的油耗', 'error');
        return;
      }
      this.oilSettings.pricePerLiter = p;
      this.oilSettings.consumptionPer100km = c;
      Storage.saveSettings({ oilSettings: this.oilSettings });
      this.showSettingsModal = false;
      this.showToast(`油价已保存：${p}元/升，油耗${c}升/百公里，每公里${(p*c/100).toFixed(2)}元`, 'success');
    },

    // ==================== Export ====================

    updateExportPreview() {
      const range = this.exportConfig.range;
      if (range === 'all') {
        const eventCount = this.events.length;
        const mileageCount = this.mileages.length;
        const totalKm = this.mileages.reduce((sum, m) => sum + m.km, 0);
        this.exportPreview = { eventCount, mileageCount, totalKm: totalKm.toFixed(1), totalCost: (totalKm * this.costPerKm).toFixed(2) };
        return;
      }

      const dateRange = Exporter.getDateRange(
        range,
        this.exportConfig.weekValue,
        this.exportConfig.monthValue
      );

      const eventCount = this.exportConfig.includeSchedule
        ? this.events.filter(e => e.date >= dateRange.start && e.date <= dateRange.end).length
        : 0;
      const mileagesInRange = this.exportConfig.includeMileage
        ? this.mileages.filter(m => m.date >= dateRange.start && m.date <= dateRange.end)
        : [];
      const totalKm = mileagesInRange.reduce((sum, m) => sum + m.km, 0);

      this.exportPreview = { eventCount, mileageCount: mileagesInRange.length, totalKm: totalKm.toFixed(1), totalCost: (totalKm * this.costPerKm).toFixed(2) };
    },

    doExport() {
      if (!this.exportConfig.includeSchedule && !this.exportConfig.includeMileage) {
        this.showToast('请至少选择一种导出内容', 'error');
        return;
      }

      const result = Exporter.export(
        this.exportConfig,
        this.events,
        this.mileages,
        this.oilSettings
      );

      Exporter.download(result.filename, result.content, result.mime);
      this.showToast(`已导出：${result.filename}`, 'success');
      this.showExportModal = false;
    },

    // ==================== Import ====================

    handleImportFile(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const result = Storage.importData(data);
          this.events = this.loadEvents();
          this.mileages = Storage.getMileages();
          this.showToast(`成功导入 ${result.events} 条日程、${result.mileages} 条里程`, 'success');
          this.showImportModal = false;
        } catch (err) {
          this.showToast('导入失败：文件格式不正确', 'error');
        }
      };
      reader.readAsText(file);
    },

    handleImportDrop(event) {
      const file = event.dataTransfer.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const result = Storage.importData(data);
          this.events = this.loadEvents();
          this.mileages = Storage.getMileages();
          this.showToast(`成功导入 ${result.events} 条日程、${result.mileages} 条里程`, 'success');
          this.showImportModal = false;
        } catch (err) {
          this.showToast('导入失败：文件格式不正确', 'error');
        }
      };
      reader.readAsText(file);
    },

    // ==================== Toast ====================

    showToast(message, type) {
      this.toast = { show: true, message, type: type || 'info' };
      setTimeout(() => {
        this.toast.show = false;
      }, 3000);
    },

    // ==================== Date Utils ====================

    getWeekStart(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return d;
    },

    getWeekNumber(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    },

    addDays(date, days) {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      return d;
    },

    formatDate(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    },

    formatDayHeader(date) {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    },

    formatWeekday(date) {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const d = date instanceof Date ? date : this.parseDateStr(date);
      return weekdays[d.getDay()];
    },

    formatDateDay(dateStr) {
      const date = this.parseDateStr(dateStr);
      return date.getDate();
    },

    parseDateStr(dateStr) {
      if (dateStr instanceof Date) return dateStr;
      const parts = String(dateStr).split('-');
      if (parts.length === 3) {
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      }
      return new Date(dateStr);
    },

    isSameDay(d1, d2) {
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate();
    }
  },

  mounted() {
    this.init();
    // PWA：注册 Service Worker（离线可用 + 可安装到主屏幕）
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
    // 捕获浏览器"可安装"事件，显示"安装"按钮
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallBtn = true;
    });
    window.addEventListener('appinstalled', () => {
      this.showInstallBtn = false;
      this.deferredPrompt = null;
    });
  }
}).mount('#app');
