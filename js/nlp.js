/**
 * nlp.js - 自然语言解析器
 * 解析中文自然语言，提取日程、里程和排程请求
 */

const NLP = {

  // 事件颜色映射
  COLOR_MAP: {
    '#3b82f6': ['会议', '开会', '讨论', '评审', 'standup', '同步'],
    '#8b5cf6': ['客户', '拜访', '会面', '接待', '签约'],
    '#ec4899': ['拍摄', '摄影', '拍照', '外景', '取景', '布光'],
    '#f59e0b': ['出差', '出行', '航班', '高铁', '出发'],
    '#14b8a6': ['培训', '学习', '课程', '讲座', '分享'],
    '#10b981': ['休息', '放假', '假期', '休假', '周末'],
    '#ef4444': ['紧急', '重要', '截止', 'deadline', 'ddl'],
    '#6366f1': [] // 默认色
  },

  // 默认分类（首次运行的种子；用户可在设置里自由增删改，自定义分类持久化在每账户 storage）
  CATEGORY_DEFAULTS: [
    { name: '策划', color: '#8b5cf6', keywords: ['策划', '筹划', '企划'] },
    { name: '拍摄', color: '#ec4899', keywords: ['拍摄', '摄影', '拍照', '取景', '布光', '外景', '拍'] },
    { name: '剪辑', color: '#f59e0b', keywords: ['剪辑', '剪片', '后期', '精修', '调色'] },
    { name: '摸鱼', color: '#14b8a6', keywords: ['摸鱼', '划水', '摸会儿鱼', '偷闲', '偷懒', '摆烂', '发呆', '放空', '躺平', '歇会儿', '休息一下', '放松一下'] },
    { name: '其他', color: '#6366f1', keywords: [] }
  ],

  // 运行时分类色板 / 关键词（由 setCategories 根据 默认 + 自定义 重建）
  CATEGORY_COLORS: {},
  CATEGORY_KEYWORDS: {},
  _categoryOrder: [],          // 推断优先级：剪辑 > 拍摄 > 策划 > 摸鱼 > 自定义（按添加顺序） > 其他
  _fallbackCategory: '其他',

  /**
   * 用分类列表（含默认）重建运行时映射。
   * @param {Array} list - [{ name, color, keywords:[] }]
   */
  setCategories(list) {
    const cats = (Array.isArray(list) && list.length) ? list : this.CATEGORY_DEFAULTS;
    const byName = {};
    this.CATEGORY_COLORS = {};
    this.CATEGORY_KEYWORDS = {};
    for (const c of cats) {
      byName[c.name] = c;
      this.CATEGORY_COLORS[c.name] = c.color || '#6366f1';
      this.CATEGORY_KEYWORDS[c.name] = Array.isArray(c.keywords) ? c.keywords : [];
    }
    const defaultOrder = ['剪辑', '拍摄', '策划', '摸鱼'];
    const order = [];
    for (const n of defaultOrder) if (byName[n]) order.push(n);
    for (const c of cats) {
      if (defaultOrder.indexOf(c.name) === -1 && c.name !== this._fallbackCategory) order.push(c.name);
    }
    if (byName[this._fallbackCategory]) order.push(this._fallbackCategory);
    this._categoryOrder = order;
  },

  // 运行时已保存常用地点（由 setLocations 根据当前账户地点列表重建），用于说话时自动联想归类
  _savedLocations: [],

  /**
   * 用常用地点列表重建运行时匹配表（影响"提到已保存地点自动归类"）。
   * @param {Array<string>} list
   */
  setLocations(list) {
    this._savedLocations = Array.isArray(list)
      ? list.map(x => (x || '').trim()).filter(Boolean)
      : [];
  },

  /**
   * 主解析入口
   * @param {string} input - 用户输入的自然语言
   * @param {Date} baseDate - 基准日期（默认今天）
   * @returns {Array} 解析结果数组
   */
  parse(input, baseDate) {
    baseDate = baseDate || new Date();
    if (!input || !input.trim()) return [];

    // 分割为多个片段
    const segments = this.splitSegments(input);
    const results = [];
    let lastEndHour = null; // 跟踪上一个事件的结束小时，用于跨片段AM/PM推断
    let lastDate = null;    // 跨片段继承的日期：首个片段明确说日期后生效，后续未说日期的片段统一沿用

    for (const seg of segments) {
      // 若上一片段已有明确日期，且本片段未再说日期，则把"默认日期"设为上一片段的日期
      const effBase = (lastDate && !this.hasExplicitDate(seg)) ? new Date(lastDate) : baseDate;
      const segResults = this.parseSegment(seg, effBase, lastEndHour);
      if (segResults) {
        const arr = Array.isArray(segResults) ? segResults : [segResults];
        // 记录该片段的原始输入文本，供备注展示
        for (const r of arr) {
          if (r && !r.raw) r.raw = seg.trim();
        }
        results.push(...arr);
        // 用本片段结果日期刷新 lastDate（便于后续片段继承；若本片段自身无日期则沿用上一片段的）
        for (const r of arr) {
          if (r && r.date) {
            const parts = r.date.split('-').map(Number);
            lastDate = new Date(parts[0], parts[1] - 1, parts[2]);
            break;
          }
        }
        // 更新lastEndHour为最大的开始时间（用于后续片段推断上下午）
        for (const r of arr) {
          if (r.type === 'schedule' && r.startTime) {
            const h = parseInt(r.startTime.split(':')[0]);
            if (lastEndHour === null || h > lastEndHour) lastEndHour = h;
          }
        }
      }
    }

    return results;
  },

  /**
   * 判断片段是否"显式"提到了日期（用于跨片段日期继承）。
   * 显式提及（今天/明天/周X/N月M号/单说N号等）→ 用自身日期；
   * 仅提到时间段（上午/下午/晚上）或完全没提 → 视为未说日期，应继承上一片段日期。
   * 注意排除"3号线/5号楼"这类含"号"字的非日期用法。
   */
  hasExplicitDate(text) {
    if (/(今(?:天|日)|明(?:天|日)|后天|大后天|昨(?:天|日)|前天|这周|下周|下下周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天])/.test(text)) return true;
    if (/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/.test(text)) return true;
    // 单说 N号 / N日（无月份），排除 号线/号楼/门牌等
    if (/(?:^|[^\d月])(?:\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[日号](?![线楼门栋室号院区座])/.test(text)) return true;
    return false;
  },

  /**
   * 分割输入为多个片段
   * 支持换行、分号分隔，以及智能逗号分割
   */
  splitSegments(input) {
    // 先按换行、分号、句号等标点分割（句号是常见的多事件分隔符，之前遗漏导致多条合并）
    let segments = input.split(/[\n；;。！!？?]/).map(s => s.trim()).filter(s => s);

    // 对每个片段，尝试按逗号智能分割
    const result = [];
    for (const seg of segments) {
      const parts = this.smartSplitByComma(seg);
      result.push(...parts);
    }
    return result;
  },

  /**
   * 智能逗号分割
   * 如果逗号后的部分以日期/时间开头，则认为是新事件
   */
  smartSplitByComma(text) {
    // 预处理：保留X，删除Y 句式不拆分（整句作为删除意图处理）
    if (/^保留\s*.+[，,、]\s*(删除|删掉|清除|清空|去掉|移除)/.test(text)) {
      return [text.trim()];
    }

    const B = '\u0001'; // 内部边界标记

    // 1) 连接词转边界：然后/之后/接着/随后/后来/再 后接时间或相对日期
    //    不再要求前面有标点，支持"拍摄然后下午剪辑"这种连写
    //    但"下班之后去健身"（之后跟"去"）不会命中，避免误拆
    text = text.replace(/(然后|之后|接着|随后|后来|再)\s*(?=(上午|下午|晚上|早上|早晨|中午|傍晚|今天|明天|后天|大后天|\d{1,2}\s*[:：点]|[零一二两三四五六七八九十]{1,3}\s*点))/g, B);

    // 2) 顿号 / 中英文逗号 / 空白 统一转为边界
    text = text.replace(/[，,、]+/g, B).replace(/\s+/g, B);

    // 3) 句中出现的时间段词（上午/下午/晚上…）前补边界
    //    前一个字若为"天"（今天/明天…）、"号/日"（21号上午…）或已是边界，则不拆，避免"今天下午/21号上午"被切开
    text = text.replace(/([^\u0001天号日])(上午|下午|中午|晚上|早上|早晨|傍晚)/g, '$1' + B + '$2');
    // 4) 句中出现的相对日期（今天/明天…）前补边界（前一字非边界时）
    text = text.replace(/([^\u0001])(今天|明天|后天|大后天|昨天|前天)/g, '$1' + B + '$2');

    let parts = text.split(B).map(s => s.trim()).filter(Boolean);

    // 开头若是"我 / 我要 / 我想"等无意义引导片段，合并进后一段，避免产生垃圾条目
    if (parts.length > 1 && /^(我|我要|我想|我今天|今天我|然后|接着)$/.test(parts[0])) {
      parts[1] = parts[0] + parts[1];
      parts.shift();
    }

    const dateStarters = /^(这|下|下下)?(?:周|星期|礼拜)[一二三四五六日天]/;
    const relDateStarters = /^(今天|明天|后天|大后天|昨天|前天)/;
    const absDateStarters = /^(?:\d{1,2}月)?(?:\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[日号](?![线楼门栋室号院区座])/;
    const timeStarters = /^(上午|下午|晚上|早上|早晨|中午|傍晚|全天)/;
    // 纯时间点开头：八点 / 9点 / 十点半 / 10:00 / 10：30 / 上午9点
    // 用中文数字或阿拉伯数字均可，避免误判"开会"这种词（无数字+点/冒号）
    const numericTimeStarters = /^(上午|下午|晚上|傍晚|早上|早晨|中午)?\s*(?:[零一二两三四五六七八九十]{1,3}|\d{1,2})\s*(?:点|[:：])/;
    // 删除命令开头：删除/清空/删掉... 或排除语法：除了X以外 / 保留X删掉其他
    const deleteStarters = /^(删除|删掉|清除|清空|去掉|移除|取消|清掉|除了|保留)/;

    const isStarter = (p) =>
      dateStarters.test(p) || relDateStarters.test(p) || absDateStarters.test(p) ||
      timeStarters.test(p) || numericTimeStarters.test(p) || deleteStarters.test(p);

    const result = [];
    for (const part of parts) {
      if (!part) continue;
      // 第一段，或以日期/时间/删除命令开头 → 作为新片段；否则合并到上一段
      if (result.length === 0 || isStarter(part)) {
        result.push(part);
      } else {
        result[result.length - 1] += '，' + part;
      }
    }

    return result;
  },

  /**
   * 解析单个片段
   * 返回数组：可能同时包含日程和里程结果
   */
  parseSegment(text, baseDate, lastEndHour) {
    text = text.trim();
    if (!text) return null;

    // 删除请求 —— 优先级最高，独占类型
    // 先尝试从文本中提取删除意图（可能前面有"我再说一个"等引导语）
    const deleteText = this.extractDeleteIntent(text);
    if (deleteText) {
      const del = this.parseDeleteRequest(deleteText, baseDate);
      if (del) return [del];
    }

    // 排程请求（找空闲时间）—— 独占类型，不交叉
    if (this.isSchedulingRequest(text)) {
      return [this.parseSchedulingRequest(text, baseDate)];
    }

    // 检测是否包含里程信息（公里/千米/km，支持中文数字）
    const hasMileage = /(\d+\.?\d*|[零一二两三四五六七八九十]+)\s*(公里|千米|km|KM)/.test(text);
    // 检测"路程算上/也算"意图但未给公里数的情况
    const mileageIntentNoKm = !hasMileage && /(路程|路|里程).*(算上|也算|都算|记上|也记|给我算|算进去|也加上)/.test(text);

    if (hasMileage) {
      // 同时生成里程记录和日程事件
      const mileage = this.parseMileage(text, baseDate);
      const schedule = this.createScheduleFromMileage(mileage, text, baseDate, lastEndHour);
      // 里程信息统一挂在日程事件上（event.km），不再单独生成一条重复的里程记录
      return schedule ? [schedule] : [mileage];
    } else if (mileageIntentNoKm) {
      // 用户希望记里程但未给公里数，生成占位记录提示补充
      const schedule = this.parseSchedule(text, baseDate, lastEndHour);
      if (schedule) {
        const parts = schedule.date.split('-');
        const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const mileage = {
          type: 'mileage',
          date: schedule.date,
          location: schedule.location || '未指定地点',
          km: 0,
          notes: '公里数待补充',
          description_text: `${this.formatDateChinese(dateObj)} ${schedule.location || '未指定地点'} 公里数待补充（请补充）`
        };
        return [schedule, mileage];
      }
      return null;
    }

    // 默认：纯日程
    const schedule = this.parseSchedule(text, baseDate, lastEndHour);
    return schedule ? [schedule] : null;
  },

  // ==================== Type Detection ====================

  isDeleteRequest(text) {
    return /^(删除|删掉|清除|清空|去掉|移除|取消|清掉)\s*/.test(text) ||
           /^除了\s*.+(以外|之外|外)/.test(text) ||
           /^保留\s*.+(删除|删掉|清除|清空|去掉|其他|其它|所有|全部)/.test(text);
  },

  /**
   * 从文本中提取删除意图片段
   * 处理"我再说一个删除..."这种带引导语的删除请求
   */
  extractDeleteIntent(text) {
    // 直接以删除词开头
    if (/^(删除|删掉|清除|清空|去掉|移除|取消|清掉)/.test(text) ||
        /^除了/.test(text) || /^保留/.test(text)) {
      return text;
    }
    // 从文中提取删除意图（带引导语的情况，如"我再说一个删除其他所有的行程"）
    // 删除词后必须跟删除目标关键词，避免"删除线"等误判
    const m = text.match(/(删除|删掉|清除|清空|去掉|移除|取消|清掉)\s*(所有|全部|其他|其它|除了|保留|今天|明天|昨天|后天|前天|本周|下周|这周|里程|数据|行程|日程|事件|安排|记录)/);
    if (m) {
      const idx = text.indexOf(m[1]);
      if (idx >= 0) return text.slice(idx);
    }
    return null;
  },

  isMileageRequest(text) {
    return /(\d+\.?\d*)\s*(公里|千米|km|KM)/.test(text) &&
           (/(拍摄|拍照|开车|去了|里程|开了|出发|到达|外景)/.test(text) ||
            /(去|到|在|从).*?(拍摄|拍|拍照)/.test(text));
  },

  isSchedulingRequest(text) {
    const patterns = [
      /帮我.*?(安排|找|排).*(时间|时段)/,
      /需要.*?(安排|找).*(时间|时段)/,
      /找个.*?(时间|时段)/,
      /什么时候.*?(有空|方便|可以)/,
      /帮我.*?安排/,
      /需要.*?小时/,
      /有没有.*?(空|时间|时段)/,
      /推荐.*?(时间|时段)/,
      /建议.*?(时间|时段)/
    ];
    return patterns.some(p => p.test(text));
  },

  // ==================== Schedule Parsing ====================

  parseSchedule(text, baseDate, lastEndHour) {
    // 提取日期
    const dateResult = this.extractDate(text, baseDate);
    let date = dateResult.date;
    let remainingText = dateResult.remaining;

    // 如果没找到日期，默认今天
    if (!date) {
      date = new Date(baseDate);
      date.setHours(0, 0, 0, 0);
    }

    // 提取时间
    const timeResult = this.extractTime(remainingText, lastEndHour);
    let startTime = timeResult.start;
    let endTime = timeResult.end;
    let isAllDay = timeResult.allDay;
    remainingText = timeResult.remaining;

    // 提取地点
    const locationResult = this.extractLocation(remainingText);
    let location = locationResult.location;
    remainingText = locationResult.remaining;

    // 推断分类（用原始片段，避免地点提取吃掉动作词导致误判）
    const category = this.inferCategory(text);

    // 清理 + 归纳标题（去除冗余连接词，只保留核心事件）
    const rawTitle = this.cleanTitle(remainingText);
    if (!rawTitle) return null;
    const title = this.summarizeTitle(rawTitle, category, location);

    // 如果没有时间，设为全天或默认时间
    if (!startTime) {
      startTime = '09:00';
      endTime = '10:00';
      isAllDay = false;
    }

    // 分配颜色（按分类优先，其他类走关键词配色）
    const color = category === '其他' ? this.assignColor(title) : this.CATEGORY_COLORS[category];

    return {
      type: 'schedule',
      title: title,
      category: category,
      date: this.formatDate(date),
      startTime: startTime,
      endTime: endTime,
      allDay: isAllDay,
      location: location,
      color: color,
      description: '',
      description_text: `${this.formatDateChinese(date)} ${startTime}-${endTime} ${title}${location ? '（地点：' + location + '）' : ''}`
    };
  },

  // ==================== Mileage Parsing ====================

  parseMileage(text, baseDate) {
    // 提取日期
    const dateResult = this.extractDate(text, baseDate);
    let date = dateResult.date;
    let remainingText = dateResult.remaining;

    if (!date) {
      date = new Date(baseDate);
      date.setHours(0, 0, 0, 0);
    }

    // 提取公里数（支持中文数字）
    const kmMatch = remainingText.match(/(\d+\.?\d*|[零一二两三四五六七八九十]+)\s*(公里|千米|km|KM)/);
    let km = 0;
    if (kmMatch) {
      km = /\d/.test(kmMatch[1]) ? parseFloat(kmMatch[1]) : (this.chineseToNumber(kmMatch[1]) || 0);
    }
    if (kmMatch) {
      remainingText = remainingText.replace(kmMatch[0], '');
    }

    // 提取地点：优先用通用语义提取，失败再走原有拍摄专用规则
    let location = '';
    const lr = this.extractLocation(remainingText);
    if (lr.location) {
      location = lr.location;
      remainingText = lr.remaining;
    } else {
      const locPatterns = [
        /去(?:了)?(.+?)(?:拍摄|拍照|拍外景|拍)/,
        /到(.+?)(?:拍摄|拍照|拍外景|拍)/,
        /在(.+?)(?:拍摄|拍照|拍外景|拍)/,
        /从(.+?)(?:出发|到|去|来)/,
        /去(?:了)?(.+?)[，,]/,
        /到(.+?)[，,]/
      ];
      for (const pattern of locPatterns) {
        const match = remainingText.match(pattern);
        if (match && match[1]) {
          location = match[1].trim()
            .replace(/^(了|过|到|在)\s*/, '')
            .replace(/(上班|开会|拍摄|拍照|培训|出差|拜访|讨论|健身|锻炼|工作)$/g, '');
          break;
        }
      }
      // 如果没找到地点，尝试提取"拍摄"前的词
      if (!location) {
        const shootMatch = remainingText.match(/(.+?)拍摄/);
        if (shootMatch) {
          location = shootMatch[1].replace(/^(去|到|在|去了|到了|在)/, '').trim();
        }
      }
    }

    // 清理备注
    let notes = '';
    if (/拍摄|拍照|拍外景/.test(remainingText)) {
      notes = '拍摄';
      if (/外景/.test(remainingText)) notes = '外景拍摄';
      if (/室内/.test(remainingText)) notes = '室内拍摄';
    }

    // 清理地点
    if (!location) location = '未指定地点';

    return {
      type: 'mileage',
      date: this.formatDate(date),
      location: location,
      km: km,
      notes: notes,
      description_text: `${this.formatDateChinese(date)} ${location} ${km}km${notes ? '（' + notes + '）' : ''}`
    };
  },

  /**
   * 从里程数据生成对应的日程事件
   * 实现"输入一次，两边同步"
   */
  createScheduleFromMileage(mileage, originalText, baseDate, lastEndHour) {
    // 构建日程标题
    let title = '';
    if (mileage.location && mileage.location !== '未指定地点') {
      title = mileage.location;
      if (mileage.notes) title += mileage.notes;
    } else if (mileage.notes) {
      title = mileage.notes;
    } else {
      title = '出行';
    }

    // 从原文中尝试提取时间信息
    const timeResult = this.extractTime(originalText, lastEndHour);
    let startTime = timeResult.start || '09:00';
    let endTime = timeResult.end || '18:00';

    // 解析日期字符串为 Date 对象（用于中文格式化）
    const parts = mileage.date.split('-');
    const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));

    const hasLocation = mileage.location && mileage.location !== '未指定地点';
    const category = this.inferCategory(title + ' ' + originalText);
    const color = category === '其他' ? this.assignColor(title) : this.CATEGORY_COLORS[category];

    return {
      type: 'schedule',
      title: title,
      category: category,
      date: mileage.date,
      startTime: startTime,
      endTime: endTime,
      allDay: false,
      location: hasLocation ? mileage.location : '',
      color: color,
      km: mileage.km,
      description: '关联里程：' + mileage.km + 'km',
      description_text: `${this.formatDateChinese(dateObj)} ${startTime}-${endTime} ${title}${hasLocation ? '（地点：' + mileage.location + '，' + mileage.km + 'km）' : '（' + mileage.km + 'km）'}`
    };
  },

  // ==================== Scheduling Request Parsing ====================

  parseSchedulingRequest(text, baseDate) {
    // 提取时长
    let duration = 60; // 默认60分钟
    const hourMatch = text.match(/(\d+\.?\d*)\s*(个?小时|h|H)/);
    const minMatch = text.match(/(\d+\.?\d*)\s*(分钟|分|min)/);
    const halfHourMatch = /半小时/.test(text);

    if (halfHourMatch) {
      duration = 30;
    } else if (hourMatch) {
      duration = Math.round(parseFloat(hourMatch[1]) * 60);
    } else if (minMatch) {
      duration = parseInt(minMatch[1]);
    }

    // 提取任务标题
    let title = text;
    // 移除请求词
    title = title.replace(/帮我.*?(安排|找|排).*(时间|时段)/, '');
    title = title.replace(/需要.*?(安排|找).*(时间|时段)/, '');
    title = title.replace(/找个.*?(时间|时段)/, '');
    title = title.replace(/什么时候.*?(有空|方便|可以)/, '');
    title = title.replace(/帮我.*?安排/, '');
    title = title.replace(/需要.*?安排/, '');
    title = title.replace(/有没有.*?(空|时间|时段)/, '');
    title = title.replace(/推荐.*?(时间|时段)/, '');
    title = title.replace(/建议.*?(时间|时段)/, '');
    title = title.replace(/(\d+\.?\d*)\s*(个?小时|h|H|分钟|分|min)/g, '');
    title = title.replace(/的时间|的时段|的时间来|来/g, '');
    title = title.replace(/^[，,、\s]+|[，,、\s]+$/g, '');
    title = title.replace(/开个?|做个?|搞个?|安排个?/g, '');

    if (!title || title.length < 2) {
      // 尝试从原文中提取名词
      const titleMatch = text.match(/(?:开|做|搞|安排)(.+?)(?:的|$)/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      } else {
        title = '待安排任务';
      }
    }

    return {
      type: 'suggestion',
      duration: duration,
      title: title,
      description_text: `需要为「${title}」找到 ${duration} 分钟的空闲时段`
    };
  },

  // ==================== Delete Request Parsing ====================

  parseDeleteRequest(text, baseDate) {
    // 移除命令词
    let t = text.replace(/^(删除|删掉|清除|清空|去掉|移除|取消|清掉)\s*/, '').trim();

    // 0. 排除语法：除了X(以外) / 保留X(,)删除其他
    // 必须最先处理，否则 extractDate 会把"今天"提取出来导致反向删除
    if (/^(除了|保留)/.test(t)) {
      // 提取保留项：到 逗号 / 以外 / 之外 / 外 / 删除命令 为止
      const m = t.match(/^(?:除了|保留)\s*(.+?)(?:\s*(?:以外|之外|外)|\s*[，,]\s*(?:删除|删掉|清除|清空|去掉|移除)|$)/);
      if (m) {
        let excepted = m[1].trim().replace(/的$/, '').trim();
        const isMileage = /里程/.test(t);

        // 尝试解析为日期
        const dateResult = this.extractDate(excepted, baseDate);
        if (dateResult.date) {
          const dateStr = this.formatDate(dateResult.date);
          const dateLabel = this.formatDateChinese(dateResult.date);
          return {
            type: 'delete',
            scope: isMileage ? 'except_date_mileages' : 'except_date_events',
            date: dateStr,
            dateLabel: dateLabel,
            description_text: `删除除${dateLabel}以外的所有${isMileage ? '里程' : '日程'}`
          };
        }

        // 否则当标题关键词排除
        let keyword = excepted.replace(/(的|日程|行程|事件|安排|里程|记录)$/g, '').trim();
        if (keyword.length >= 2) {
          return {
            type: 'delete',
            scope: 'except_title_events',
            keyword: keyword,
            description_text: `删除除「${keyword}」以外的所有日程`
          };
        }
      }
      // 兜底
      return {
        type: 'delete',
        scope: 'all_events',
        description_text: '清空所有日程'
      };
    }

    // 1. 全部数据（日程 + 里程）
    if (/数据/.test(t)) {
      return {
        type: 'delete',
        scope: 'all_data',
        description_text: '清空所有数据（日程 + 里程）'
      };
    }

    // 2. 含"里程"关键词 —— 删里程
    if (/里程/.test(t)) {
      // 含日期 → 按日期删里程
      const dateResult = this.extractDate(t, baseDate);
      if (dateResult.date) {
        return {
          type: 'delete',
          scope: 'date_mileages',
          date: this.formatDate(dateResult.date),
          dateLabel: this.formatDateChinese(dateResult.date),
          description_text: `删除${this.formatDateChinese(dateResult.date)}的里程`
        };
      }
      // 否则删全部里程
      return {
        type: 'delete',
        scope: 'all_mileages',
        description_text: '清空所有里程记录'
      };
    }

    // 3. 删除所有日程/行程（含"所有/全部/清空"或空，或"其他/其它"开头——用户说"删除其他所有的行程"意图是清空）
    if (t === '' || /^(所有|全部|清空|清除)/.test(t) ||
        /^(其他|其它)/.test(t) ||
        /^(所有|全部|其他|其它)(的)?(日程|行程|事件|安排|记录)/.test(t)) {
      return {
        type: 'delete',
        scope: 'all_events',
        description_text: '清空所有日程'
      };
    }

    // 4. 按日期删除日程
    const dateResult = this.extractDate(t, baseDate);
    if (dateResult.date) {
      return {
        type: 'delete',
        scope: 'date_events',
        date: this.formatDate(dateResult.date),
        dateLabel: this.formatDateChinese(dateResult.date),
        description_text: `删除${this.formatDateChinese(dateResult.date)}的日程`
      };
    }

    // 5. 按标题模糊匹配删除日程
    let keyword = t.replace(/(这个|那个|的|日程|行程|事件|安排|记录)$/g, '').trim();
    keyword = keyword.replace(/^[的]+|[的]+$/g, '').trim();
    if (keyword.length >= 2) {
      return {
        type: 'delete',
        scope: 'title_events',
        keyword: keyword,
        description_text: `删除包含「${keyword}」的日程`
      };
    }

    // 兜底：删除所有日程
    return {
      type: 'delete',
      scope: 'all_events',
      description_text: '清空所有日程'
    };
  },

  // ==================== Date Extraction ====================

  extractDate(text, baseDate) {
    const today = new Date(baseDate);
    today.setHours(0, 0, 0, 0);
    let date = null;
    let remaining = text;

    // 大后天 (check before 后天)
    if (/大后天/.test(remaining)) {
      date = new Date(today);
      date.setDate(date.getDate() + 3);
      remaining = remaining.replace(/大后天/g, '');
    }
    // 后天
    else if (/后天/.test(remaining)) {
      date = new Date(today);
      date.setDate(date.getDate() + 2);
      remaining = remaining.replace(/后天/g, '');
    }
    // 明天 / 明日
    else if (/明(?:天|日)/.test(remaining)) {
      date = new Date(today);
      date.setDate(date.getDate() + 1);
      remaining = remaining.replace(/明(?:天|日)/g, '');
    }
    // 昨天 / 昨日
    else if (/昨(?:天|日)/.test(remaining)) {
      date = new Date(today);
      date.setDate(date.getDate() - 1);
      remaining = remaining.replace(/昨(?:天|日)/g, '');
    }
    // 前天
    else if (/前天/.test(remaining)) {
      date = new Date(today);
      date.setDate(date.getDate() - 2);
      remaining = remaining.replace(/前天/g, '');
    }
    // 今天 / 今日
    else if (/今(?:天|日)/.test(remaining)) {
      date = new Date(today);
      remaining = remaining.replace(/今(?:天|日)/g, '');
    }
    // 周X / 星期X / 礼拜X
    else {
      const weekdayMatch = remaining.match(/(这|下|下下)?(?:周|星期|礼拜)(一|二|三|四|五|六|日|天)/);
      if (weekdayMatch) {
        const prefix = weekdayMatch[1] || '';
        const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
        const targetDay = dayMap[weekdayMatch[2]];

        date = new Date(today);
        const currentDay = date.getDay();
        let diff = targetDay - currentDay;

        if (prefix === '下') {
          if (diff <= 0) diff += 7;
          diff += 7;
        } else if (prefix === '下下') {
          diff += 14;
        } else {
          // 这周 or no prefix
          if (diff < 0) diff += 7;
        }

        date.setDate(date.getDate() + diff);
        remaining = remaining.replace(weekdayMatch[0], '');
      }
      // X月X日 / X月X号
      else {
        const dateMatch = remaining.match(/(\d{1,2})月(\d{1,2})[日号]/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1]) - 1;
          const day = parseInt(dateMatch[2]);
          date = new Date(today.getFullYear(), month, day);
          if (date < today) date.setFullYear(date.getFullYear() + 1);
          remaining = remaining.replace(dateMatch[0], '');
        }
        // 单说"N号 / N日"（无月份）→ 当月N号（支持中文数字"二十一号"）
        // 排除"3号线 / 5号楼"这类非日期用法
        else {
          const bareDayMatch = remaining.match(/(?:^|[^\d月])(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[日号](?![线楼门栋室号院区座])/);
          if (bareDayMatch) {
            const day = /\d/.test(bareDayMatch[1])
              ? parseInt(bareDayMatch[1])
              : this.chineseToNumber(bareDayMatch[1]);
            if (day >= 1 && day <= 31) {
              date = new Date(today.getFullYear(), today.getMonth(), day);
              // 只替换"N号"本身，保留前面误捕获的那个字符
              remaining = remaining.replace(
                bareDayMatch[0],
                bareDayMatch[0].replace(new RegExp(bareDayMatch[1] + '\\s*[日号]'), '')
              );
            }
          }
        }
      }
    }

    return { date, remaining };
  },

  // ==================== Time Extraction ====================

  /**
   * 中文数字转阿拉伯数字（支持 0-99）
   */
  chineseToNumber(str) {
    if (!str) return null;
    if (/^\d+$/.test(str)) return parseInt(str);
    const map = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    // 单字
    if (str.length === 1) return map[str] !== undefined ? map[str] : null;
    // "十X" = 10+X
    if (str[0] === '十') return 10 + (map[str[1]] !== undefined ? map[str[1]] : 0);
    // "X十" = X*10
    if (str[str.length - 1] === '十') return (map[str[0]] !== undefined ? map[str[0]] : 0) * 10;
    // "X十Y" = X*10+Y
    if (str.length === 3 && str[1] === '十') {
      return (map[str[0]] !== undefined ? map[str[0]] : 0) * 10 + (map[str[2]] !== undefined ? map[str[2]] : 0);
    }
    return null;
  },

  extractTime(text, lastEndHour) {
    let remaining = text;
    let start = null, end = null, allDay = false;

    // 预处理：中文数字时间转阿拉伯（"七点"→"7点"、"十一点"→"11点"、"八点半"→"8点半"、"两点"→"2点"）
    remaining = remaining.replace(/([零一二两三四五六七八九十]+)\s*点/g, (m, cn) => {
      const n = this.chineseToNumber(cn);
      return n !== null ? n + '点' : m;
    });

    // 全天
    if (/全天|一整天|整天/.test(remaining)) {
      start = '00:00';
      end = '23:59';
      allDay = true;
      remaining = remaining.replace(/全天|一整天|整天/g, '');
      return { start, end, allDay, remaining };
    }

    // 检测上午/下午/晚上 上下文
    const hasPM = /下午|晚上|傍晚|pm|PM/.test(remaining);
    const hasAM = /上午|早上|早晨|am|AM/.test(remaining);

    // 时间范围: X点到Y点 / X:00-Y:00 / X点-Y点
    // 包含可选的上午/下午前缀，使其一起被移除
    const rangePatterns = [
      /(?:上午|下午|晚上|傍晚|早上|早晨|中午)?\s*(\d{1,2})[:：点](\d{0,2})?\s*(?:半)?\s*[到至\-~–]\s*(\d{1,2})[:：点](\d{0,2})?\s*(?:半)?/,
      /(?:上午|下午|晚上|傍晚|早上|早晨|中午)?\s*(\d{1,2})[:：点](\d{2})\s*[到至\-~–]\s*(\d{1,2})[:：点](\d{2})/,
    ];

    for (const pattern of rangePatterns) {
      const match = remaining.match(pattern);
      if (match) {
        let startHour = parseInt(match[1]);
        let startMin = match[2] && match[2].length > 0 ? parseInt(match[2]) : 0;
        let endHour = parseInt(match[3]);
        let endMin = match[4] && match[4].length > 0 ? parseInt(match[4]) : 0;

        // 处理"半"
        if (/半/.test(match[0])) {
          if (match[0].indexOf('半') < match[0].indexOf('到') &&
              match[0].indexOf('到') > 0 &&
              match[0].indexOf('半') < match[0].indexOf('到')) {
            startMin = 30;
          }
          // Check if 半 is after the second time
          const afterDash = match[0].split(/[到至\-~–]/)[1];
          if (afterDash && /半/.test(afterDash)) {
            endMin = 30;
          }
        }

        // AM/PM 转换
        if (hasPM) {
          if (startHour < 12) startHour += 12;
          if (endHour < 12) endHour += 12;
        } else if (!hasAM && lastEndHour != null) {
          // 无明确上下午，但有时间上下文：若早于上一事件结束时间，推断为下午
          if (startHour < lastEndHour) startHour += 12;
          if (endHour < lastEndHour) endHour += 12;
        } else if (!hasAM) {
          // 无上下文，凌晨0-6点罕见，推断为下午
          if (startHour < 7) startHour += 12;
          if (endHour < 7) endHour += 12;
        }

        start = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
        end = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
        remaining = remaining.replace(match[0], '');
        return { start, end, allDay, remaining };
      }
    }

    // 单一时间点: X点 / X:00 / X点半
    // 包含可选的上午/下午前缀，使其一起被移除
    const singlePatterns = [
      /(?:上午|下午|晚上|傍晚|早上|早晨|中午)?\s*(\d{1,2})[:：点](\d{1,2})\s*(?:半)?/,
      /(?:上午|下午|晚上|傍晚|早上|早晨|中午)?\s*(\d{1,2})\s*点\s*半/,
      /(?:上午|下午|晚上|傍晚|早上|早晨|中午)?\s*(\d{1,2})\s*点/,
    ];

    for (const pattern of singlePatterns) {
      const match = remaining.match(pattern);
      if (match) {
        let hour = parseInt(match[1]);
        let min = 0;

        if (match[2] && match[2].length > 0 && parseInt(match[2]) < 60) {
          min = parseInt(match[2]);
        }

        // 检查"半"
        if (/半/.test(match[0])) {
          min = 30;
        }

        // AM/PM 转换
        if (hasPM && hour < 12) {
          hour += 12;
        } else if (!hasAM && lastEndHour != null && hour < lastEndHour) {
          // 无明确上下午，但早于上一事件结束时间 → 推断为下午
          hour += 12;
        } else if (!hasAM && hour < 7) {
          // 无上下文，凌晨0-6点罕见，推断为下午
          hour += 12;
        }

        start = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        // 默认1小时
        let endHour = hour + 1;
        if (endHour > 23) endHour = 23;
        end = `${String(endHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

        remaining = remaining.replace(match[0], '');
        return { start, end, allDay, remaining };
      }
    }

    // 时间段（无具体时间）—— 上午/下午默认对应工作时间
    if (/上午|早上|早晨/.test(remaining)) {
      start = '08:30';
      end = '11:30';
      remaining = remaining.replace(/上午|早上|早晨/g, '');
    } else if (/下午/.test(remaining)) {
      start = '13:30';
      end = '17:00';
      remaining = remaining.replace(/下午/g, '');
    } else if (/晚上|傍晚/.test(remaining)) {
      start = '19:00';
      end = '22:00';
      remaining = remaining.replace(/晚上|傍晚/g, '');
    } else if (/中午/.test(remaining)) {
      start = '12:00';
      end = '14:00';
      remaining = remaining.replace(/中午/g, '');
    }

    return { start, end, allDay, remaining };
  },

  // ==================== Location Extraction ====================

  extractLocation(text) {
    let location = '';
    let remaining = text;

    // 1. 命中已保存的常用地点（最长优先，支持"公司楼下"→"公司"这类包含匹配）
    //    优先级最高：用户说话提到已保存地点时，自动把事件归类到该地点
    if (Array.isArray(this._savedLocations) && this._savedLocations.length) {
      const sorted = [...this._savedLocations].sort((a, b) => b.length - a.length);
      for (const loc of sorted) {
        if (loc && text.includes(loc)) {
          location = loc;
          remaining = text.replace(loc, '');
          return { location, remaining };
        }
      }
    }

    // 2. 地点在XXX / 地点：XXX（显式标注）
    const explicitMatch = remaining.match(/地点[在：:]\s*(.+?)(?:[，,；;]|$)/);
    if (explicitMatch) {
      location = explicitMatch[1].trim();
      remaining = remaining.replace(explicitMatch[0], '');
      return { location, remaining };
    }

    // 3. 介词 + 地点 +（活动词 / 时间词 / 标点）：在/到/去/从/往 X + 后续活动或时间
    const ACT = '拍摄|拍照|拍外景|拍|开会|开会讨论|开会评审|培训|出差|拜访|讨论|见面|碰面|上班|下班|加班|值班|健身|锻炼|工作|吃饭|聚餐|聚会|约会|取景|布光|剪辑|排版|学习|考试|面试|出发|回来|返回|回家|飞|喝|唱|按摩|理发|逛街|逛|玩|购物|旅游|看电影|看|做|进行|跑步|运动|散步|遛狗|等人|等|办事|办|买|取|接|送|修车|保养|洗车|提车|签|谈|聊|待|呆|住|休息';
    const TIME = '上午|下午|晚上|早上|中午|傍晚|早晨|凌晨|明天|今天|后天|大后天|昨天|前天|周一|周二|周三|周四|周五|周六|周日|周几|周末|\\d+\\s*点|\\d+[:：]|点';
    const p = new RegExp('(?:在|到|去|从|往|离)\\s*([^\\s，,；;。、]+?)(?=(?:' + ACT + '|' + TIME + '|[，,。；;、]|$))');
    const m = remaining.match(p);
    if (m && m[1] && !/^(了|过|这|那|这里|那里|这儿|那儿)$/.test(m[1])) {
      const cand = m[1].trim();
      // 兜底：若截取的整段本身就是某个活动词（如「健身」「吃饭」），则不算地点
      if (!ACT.split('|').some(a => a && cand === a)) {
        location = cand;
        remaining = remaining.replace(m[0], m[0].replace(m[1], ''));
        return { location, remaining };
      }
    }

    return { location, remaining };
  },

  // ==================== Title Cleaning ====================

  cleanTitle(text) {
    let title = text;
    // 移除引导词和前缀（循环清理，处理"的话我要"这种连续前缀；g+^正则只匹配一次，需循环）
    let prev;
    do {
      prev = title;
      title = title.replace(/^(这周|本周|下周|这周的安排是|安排是|的话|我要|我想|我得|我需要|也是|要|需要|计划|打算|准备|这个|那个|就是|也就是说|另外|还有|再就是|然后|之后|接着|随后|后来|大概|可能|应该|差不多|一下|的话是|我)\s*[：:，,]?\s*/, '');
      // 移除时间前缀词（上午/下午/晚上等，extractTime 未识别时兜底清理）
      title = title.replace(/^(上午|下午|晚上|早上|早晨|中午|傍晚)\s*/, '');
    } while (title !== prev && title.length > 0);
    // 移除"路程...算上"这类里程意图描述（不是日程标题内容）
    title = title.replace(/[，,]?\s*(这个)?路程.{0,8}(算上|也算|都算|记上|也记|给我算|算进去).*/g, '');
    // 去掉末尾包含时间描述的段落（如"去健身，健身到6点/健身到十点/健身到"→"去健身"），时间数字和"点"均可选
    title = title.replace(/[，,]\s*[^，,]*(?:到|至)\s*(?:[零一二两三四五六七八九十\d]{1,3}\s*[:：点]?)?[^，,]*$/g, '');
    // 移除末尾的"这个路程算上"等里程意图补充说明
    title = title.replace(/[，,]?\s*(这个)?(路程|路|里程).{0,6}(算上|也算|都算|记上|也记|给我算|算进去|也加上).*/g, '');
    // 移除首尾标点和空格
    title = title.replace(/^[，,、：:\s]+|[，,、：:\s]+$/g, '');
    // 移除多余的"的"
    title = title.replace(/^的|的$/g, '');
    return title.trim();
  },

  // ==================== Color Assignment ====================

  assignColor(title) {
    const lowerTitle = title.toLowerCase();
    for (const [color, keywords] of Object.entries(this.COLOR_MAP)) {
      if (keywords.some(kw => lowerTitle.includes(kw.toLowerCase()))) {
        return color;
      }
    }
    return '#6366f1'; // 默认色
  },

  // ==================== Category Inference ====================

  /**
   * 推断日程分类（策划 / 拍摄 / 剪辑 / 摸鱼 / 其他）
   * 顺序很重要：剪辑优先于拍摄（避免误判），拍摄优先于策划
   */
  inferCategory(text) {
    const t = text || '';
    for (const name of this._categoryOrder) {
      if (name === this._fallbackCategory) continue;
      const kws = this.CATEGORY_KEYWORDS[name] || [];
      if (kws.some(k => k && t.includes(k))) return name;
    }
    return this._fallbackCategory;
  },

  /**
   * 归纳标题：去除冗余连接词，只保留核心事件
   * 例：
   *   "做了你好守美人这个栏目的策划" → "你好守艺人栏目策划"
   *   "去拍摄了光影服务队"           → "光影服务队拍摄"
   * 分类事件重组为「核心对象 + 分类动作」；其他类仅做轻量清理
   * @param {string} rawTitle  清理后的标题
   * @param {string} category  分类
   * @param {string} location  提取到的地点（对象词可能被地点提取吃掉时的兜底）
   */
  summarizeTitle(rawTitle, category, location) {
    let t = (rawTitle || '').trim();
    if (!t) {
      // 标题被清空时，用地点兜底
      if (location) return location + (category !== '其他' ? category : '');
      return category !== '其他' ? category : t;
    }

    // 1) 去掉开头冗余动词 / 代词（循环处理连续前缀，如"我去"）
    let prev;
    do {
      prev = t;
      t = t.replace(/^(我|做了|搞了|弄了|进行|开展|负责|参加|参与|完成|去了|去|到|在|跟|和|给|帮|做|弄)\s*/, '');
    } while (t !== prev && t.length > 0);

    // 2) 去掉"这个/那个/的/了/呀/啊"等冗余字
    t = t.replace(/(这个|那个|的|了|呀|啊|呢|吧|哦|嘛|哈)/g, '');
    t = t.trim();

    // 3) 按分类重组为「对象 + 动作」
    if (category === '拍摄') {
      let obj = t.replace(/(拍摄|摄影|拍照|取景|布光|外景|拍)/g, '').replace(/^的|的$/g, '').trim();
      if (!obj && location) obj = location;
      return obj ? obj + '拍摄' : '拍摄';
    }
    if (category === '策划') {
      let obj = t.replace(/(策划|筹划|企划)/g, '').replace(/^的|的$/g, '').trim();
      if (!obj && location) obj = location;
      return obj ? obj + '策划' : '策划';
    }
    if (category === '剪辑') {
      let obj = t.replace(/(剪辑|剪片|后期|精修|调色)/g, '').replace(/^的|的$/g, '').trim();
      if (!obj && location) obj = location;
      return obj ? obj + '剪辑' : '剪辑';
    }
    if (category === '摸鱼') {
      let obj = t.replace(/(摸鱼|划水|摸会儿鱼|偷闲|偷懒|摆烂|发呆|放空|躺平|歇会儿|休息|放松)/g, '').replace(/^的|的$/g, '').trim();
      if (!obj && location) obj = location;
      return obj ? obj + '摸鱼' : '摸鱼';
    }

    // 自定义 / 通用分类：去掉该分类的关键词后拼成「对象 + 分类名」
    if (this.CATEGORY_KEYWORDS[category] && this.CATEGORY_KEYWORDS[category].length) {
      const pat = new RegExp(
        this.CATEGORY_KEYWORDS[category]
          .map(k => (k || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .filter(Boolean)
          .join('|'),
        'g'
      );
      let obj = t.replace(pat, '').replace(/^的|的$/g, '').trim();
      if (!obj && location) obj = location;
      return obj ? obj + category : category;
    }

    // 其他类：返回清理后的标题
    return t;
  },

  // ==================== Date Utils ====================

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  formatDateChinese(date) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));

    let prefix = '';
    if (diff === 0) prefix = '今天';
    else if (diff === 1) prefix = '明天';
    else if (diff === 2) prefix = '后天';
    else if (diff === -1) prefix = '昨天';
    else prefix = `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;

    return prefix;
  }
};

// Export to global
window.NLP = NLP;
// 初始化默认分类映射（app 加载账户分类后会再次调用 setCategories 覆盖）
NLP.setCategories(NLP.CATEGORY_DEFAULTS);
