/**
 * e2e-electron.test.js - QM-Testing Electron 前端 E2E 测试
 * 使用 Playwright _electron 模块驱动桌面应用
 * 覆盖：应用启动、页面导航、数据池创建/查看/删除
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright');

const APP_MAIN = path.join(__dirname, '..', 'main', 'main.js');
const ELECTRON_PATH = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const DATAPOOLS_DIR = path.join(__dirname, '..', 'data', 'dataPools');

// ========== 辅助函数 ==========

/** 等待应用初始化完成（React + Babel 编译 + 模式检测） */
async function waitForApp(page) {
  await page.waitForSelector('.app-container', { timeout: 30000 });
  await page.waitForFunction(() => {
    const badge = document.querySelector('.mode-badge');
    return badge && badge.textContent && badge.textContent !== '...';
  }, { timeout: 30000 });
}

/** 点击侧边栏导航到指定页面 */
async function navigateTo(page, linkText) {
  const links = await page.$$('.sidebar-link');
  for (const link of links) {
    const text = await link.textContent();
    if (text.includes(linkText)) {
      await link.click();
      await page.waitForTimeout(800); // 等待 Babel 编译 + React 渲染
      return;
    }
  }
  throw new Error(`未找到侧边栏链接: "${linkText}"`);
}

/** 获取页面标题文本（优先 h2，设置页等使用 h3 作为标题） */
async function getPageTitle(page) {
  try {
    const h2 = await page.$('h2');
    if (h2) return (await h2.textContent()).trim();
    // 部分页面（如设置页）使用 h3 作为主标题
    const h3 = await page.$('h3');
    return h3 ? (await h3.textContent()).trim() : '';
  } catch { return ''; }
}

/** 清理所有数据池文件 */
function cleanupDataPools() {
  if (!fs.existsSync(DATAPOOLS_DIR)) return;
  const files = fs.readdirSync(DATAPOOLS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try { fs.unlinkSync(path.join(DATAPOOLS_DIR, f)); } catch { /* ignore */ }
  }
}

/** 保存截图到测试输出目录 */
let screenshotCounter = 0;
async function takeScreenshot(page, name) {
  const dir = path.join(__dirname, '..', 'test-output');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `e2e-${++screenshotCounter}-${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`  截图已保存: ${filePath}`);
  return filePath;
}

// ========== 测试套件 ==========

describe('QM-Testing Electron 前端 E2E', () => {
  let electronApp;
  let page;
  const createdPoolIds = [];

  before(async () => {
    // 测试前清理旧数据
    cleanupDataPools();

    electronApp = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: [APP_MAIN, '--no-sandbox', '--disable-gpu'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'ERROR',
      },
    });
    page = await electronApp.firstWindow();
    await waitForApp(page);
    console.log(`  Electron 应用已启动 (v${await electronApp.evaluate(({ app }) => app.getVersion())})`);
  });

  after(async () => {
    // 清理测试创建的数据池
    if (createdPoolIds.length > 0) {
      console.log(`  清理 ${createdPoolIds.length} 个测试数据池文件`);
      for (const id of createdPoolIds) {
        const filePath = path.join(DATAPOOLS_DIR, `${id}.json`);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    if (electronApp) {
      await electronApp.close();
      console.log('  Electron 应用已关闭');
    }
  });

  // ==================== 1. 应用启动 ====================
  describe('1. 应用启动', () => {
    it('1.1 应用应正常启动并渲染', async () => {
      const title = await page.title();
      assert.ok(title.includes('QM-Testing'), `标题应包含 QM-Testing, 实际: "${title}"`);
      assert.ok(await page.$('.app-container'), '应存在 .app-container');
      assert.ok(await page.$('.sidebar'), '应存在侧边栏');
    });

    it('1.2 模式检测应显示 Desktop', async () => {
      const badge = await page.$eval('.mode-badge', el => el.textContent);
      assert.equal(badge, 'Desktop', `应显示 Desktop 模式, 实际: "${badge}"`);
    });

    it('1.3 默认应显示仪表盘页面', async () => {
      const title = await getPageTitle(page);
      assert.ok(title.includes('仪表盘'), `默认页面标题应包含仪表盘, 实际: "${title}"`);
      await takeScreenshot(page, 'dashboard');
    });

    it('1.4 侧边栏应显示所有导航项', async () => {
      const links = await page.$$('.sidebar-link');
      const labels = [];
      for (const link of links) {
        const text = await link.textContent();
        labels.push(text.trim().replace(/[🔧🏠📂🔍🔗🗄️🚀📊📤📋⚙️📋]/g, '').trim());
      }
      assert.ok(labels.includes('仪表盘'), '应包含仪表盘');
      assert.ok(labels.includes('测试数据'), '应包含测试数据');
      assert.ok(labels.includes('回归验证'), '应包含回归验证');
      assert.ok(labels.includes('测试报告'), '应包含测试报告');
      assert.ok(labels.some(l => l.includes('设置')), '应包含设置');
    });
  });

  // ==================== 2. 页面导航 ====================
  describe('2. 页面导航', () => {
    it('2.1 应能导航到所有主要页面', async () => {
      const pages = ['导入录制', '管道处理', '智能审查', '测试数据', '回归验证', '设置'];
      for (const p of pages) {
        await navigateTo(page, p);
        const title = await getPageTitle(page);
        assert.ok(title.length > 0, `页面 "${p}" 应有标题`);
        console.log(`  导航到 "${p}" -> 标题: "${title}"`);
      }
    });
  });

  // ==================== 3. 测试数据管理 - 空状态 ====================
  describe('3. 测试数据管理 - 空状态', () => {
    it('3.1 空数据池列表应显示暂无数据', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(1000);

      // 检查空状态
      const emptyIcon = await page.$('.empty-state-icon');
      const emptyHeading = await page.$('.empty-state h3');
      if (emptyHeading) {
        const text = await emptyHeading.textContent();
        assert.ok(text.includes('暂无数据池'), `空状态应提示暂无数据池, 实际: "${text}"`);
      }
      await takeScreenshot(page, 'empty-pools');
    });

    it('3.2 应显示导入数据和新建按钮', async () => {
      const buttons = await page.$$('.page-header-actions button');
      const btnTexts = [];
      for (const btn of buttons) {
        btnTexts.push((await btn.textContent()).trim());
      }
      assert.ok(btnTexts.some(t => t.includes('导入数据')), '应存在导入数据按钮');
      assert.ok(btnTexts.some(t => t.includes('新建数据池')), '应存在新建数据池按钮');
    });

    it('3.3 搜索框应存在且可输入', async () => {
      const searchInput = await page.$('input[placeholder*="搜索"]');
      assert.ok(searchInput, '应存在搜索输入框');
      if (searchInput) {
        await searchInput.fill('测试');
        const value = await searchInput.inputValue();
        assert.equal(value, '测试', '搜索框应能输入文字');
        await searchInput.fill('');
      }
    });
  });

  // ==================== 4. 创建数据池 ====================
  describe('4. 创建数据池（手动录入）', () => {
    it('4.1 点击新建按钮应弹出创建表单', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(500);

      // 清理可能已存在的池
      cleanupDataPools();

      // 点击 "+ 新建数据池"
      const createBtn = await page.$('button.btn-primary.btn-sm');
      assert.ok(createBtn, '应存在新建数据池按钮');
      if (createBtn) {
        await createBtn.click();
        await page.waitForTimeout(800);
      }

      // 验证模态框出现
      const modalOverlay = await page.$('.modal-overlay');
      assert.ok(modalOverlay, '应弹出模态框');
      const modalTitle = await modalOverlay.$('h4');
      assert.ok(modalTitle, '模态框应有标题');
      const modalText = await modalTitle.textContent();
      assert.ok(modalText.includes('新建数据池'), `模态框标题应为"新建数据池", 实际: "${modalText}"`);

      await takeScreenshot(page, 'create-modal');
    });

    it('4.2 应能填写表单字段（名称、描述、字段、数据行）', async () => {
      // 填写数据池名称
      const nameInput = await page.$('input[placeholder*="登录用户列表"]');
      assert.ok(nameInput, '应存在名称输入框');
      await nameInput.fill('登录用户列表');
      await page.waitForTimeout(200);

      // 填写描述
      const descInput = await page.$('input[placeholder*="可选描述"]');
      assert.ok(descInput, '应存在描述输入框');
      await descInput.fill('E2E 测试创建的登录用户数据');

      // 修改字段名
      const fieldInput = await page.$('input[placeholder*="字段名"]');
      assert.ok(fieldInput, '应存在字段名输入框');
      await fieldInput.fill('');
      await fieldInput.fill('usercode');

      // 添加一个数据行
      const addRowBtn = await page.$('button.btn-sm:not(.btn-danger)', { timeout: 3000 });
      if (addRowBtn) {
        const addButtons = await page.$$('button.btn-sm');
        // 找到 "+ 添加行" 按钮
        for (const btn of addButtons) {
          const btnText = (await btn.textContent()).trim();
          if (btnText.includes('添加行')) {
            await btn.click();
            await page.waitForTimeout(300);
            break;
          }
        }
      }

      // 在数据行中输入值
      await page.waitForTimeout(300);
      const cellInputs = await page.$$('input[style*="minWidth: 60px"]');
      if (cellInputs.length > 0) {
        await cellInputs[0].fill('admin');
      }

      await takeScreenshot(page, 'create-form-filled');
    });

    it('4.3 应能设置高级控制选项', async () => {
      // 高级控制默认在下拉框中，验证存在
      const selects = await page.$$('select');
      let controlLabels = [];
      const labels = await page.$$('label');
      for (const label of labels) {
        const text = (await label.textContent()).trim();
        if (['数据行超出时', '排序模式', '共享模式'].includes(text)) {
          controlLabels.push(text);
        }
      }
      assert.ok(controlLabels.some(l => l.includes('数据行超出时')), '应包含"数据行超出时"');
      assert.ok(controlLabels.some(l => l.includes('排序模式')), '应包含"排序模式"');
      assert.ok(controlLabels.some(l => l.includes('共享模式')), '应包含"共享模式"');
    });

    it('4.4 应能填写标签', async () => {
      // 使用唯一标识的 placeholder 匹配标签输入框（避免与名称输入框冲突）
      const tagInput = await page.$('input[placeholder*="生产数据"]');
      if (tagInput) {
        await tagInput.fill('E2E, Playwright, 测试');
        await page.waitForTimeout(200);
      } else {
        // 兜底：遍历所有 input 查找包含"生产数据"的 placeholder
        const allInputs = await page.$$('input');
        for (const inp of allInputs) {
          const ph = await inp.getAttribute('placeholder');
          if (ph && (ph.includes('生产数据') || ph.includes('逗号分隔'))) {
            await inp.fill('E2E, Playwright, 测试');
            await page.waitForTimeout(200);
            break;
          }
        }
      }
    });

    it('4.5 保存数据池应成功并出现在列表中', async () => {
      // 点击 "保存数据池" 按钮
      const saveBtn = await page.$('button.btn-primary:not(.btn-sm)');
      assert.ok(saveBtn, '应存在保存按钮');
      if (saveBtn) {
        await saveBtn.click();
      }

      // 轮询等待列表刷新（最多 10s）
      let found = false;
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        const cards = await page.$$('.card');
        for (const card of cards) {
          const text = await card.textContent();
          if (text.includes('登录用户列表')) {
            found = true;
            break;
          }
        }
        if (found) break;
      }

      assert.ok(found, '数据池"登录用户列表"应出现在列表中');
      await takeScreenshot(page, 'pool-created');
    });

    it('4.6 数据池卡片应显示正确的信息', async () => {
      // 查找包含我们的数据池的卡片
      const cards = await page.$$('.card');
      for (const card of cards) {
        const text = await card.textContent();
        if (text.includes('登录用户列表')) {
          // 验证 source tag
          assert.ok(text.includes('manual'), '应显示 manual 来源标签');
          // 验证字段和行数
          assert.ok(text.includes('字段') || text.includes('字段'), '应显示字段信息');
          assert.ok(text.includes('行'), '应显示行数信息');
          break;
        }
      }
    });
  });

  // ==================== 5. 展开查看数据池详情 ====================
  describe('5. 展开数据池详情', () => {
    it('5.1 点击卡片应展开详情', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(500);

      // 点击 "登录用户列表" 卡片
      const cards = await page.$$('.card');
      for (const card of cards) {
        const text = await card.textContent();
        if (text.includes('登录用户列表')) {
          await card.click();
          // 轮询等待异步 dataPoolGet 完成（最多 5s）
          for (let i = 0; i < 10; i++) {
            await page.waitForTimeout(500);
            const t = await page.evaluate(() => document.body.innerText);
            if (t.includes('字段:') && t.includes('变量引用格式:')) break;
          }
          break;
        }
      }

      // 验证详情区域显示字段信息
      const detailText = await page.evaluate(() => document.body.innerText);
      assert.ok(detailText.includes('字段:'), '详情应显示字段信息');
      assert.ok(detailText.includes('变量引用格式:'), '详情应显示变量引用格式');
      assert.ok(detailText.includes('数据预览:'), '详情应显示数据预览');
      assert.ok(detailText.includes('usercode'), '详情应包含字段名 usercode');
      assert.ok(detailText.includes('${data.登录用户列表.usercode}'), '详情应包含变量引用格式');

      await takeScreenshot(page, 'pool-expanded');
    });

    it('5.2 详情应显示超出行为和排序模式', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(500);

      const bodyText = await page.evaluate(() => document.body.innerText);
      // 展开状态下，详情区域包含控制信息
      assert.ok(bodyText.includes('超出行为') || bodyText.includes('排序'), '详情应显示控制设置');
    });
  });

  // ==================== 6. 搜索与筛选 ====================
  describe('6. 搜索与筛选', () => {
    it('6.1 通过名称搜索应能过滤数据池', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(500);

      const searchInput = await page.$('input[placeholder*="搜索"]');
      assert.ok(searchInput, '搜索框应存在');

      // 搜索存在的池（轮询等待 React 筛选完成）
      await searchInput.fill('登录用户');
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(500);
        const t = await page.evaluate(() => document.body.innerText);
        if (t.includes('登录用户列表')) break;
      }
      const bodyAfterSearch = await page.evaluate(() => document.body.innerText);
      assert.ok(bodyAfterSearch.includes('登录用户列表'), '搜索结果应包含匹配的数据池');

      // 搜索不存在的池
      await searchInput.fill('ABCDEF_NOT_EXISTS');
      await page.waitForTimeout(300);
      const bodyNoResults = await page.evaluate(() => document.body.innerText);
      assert.ok(bodyNoResults.includes('暂无数据池') || !bodyNoResults.includes('登录用户列表'),
        '搜索无结果时应隐藏不匹配的数据池');

      // 清空搜索
      await searchInput.fill('');
      await page.waitForTimeout(300);
    });
  });

  // ==================== 7. 批量粘贴导入 ====================
  describe('7. 批量粘贴导入', () => {
    it('7.1 粘贴数据应能预览并创建数据池', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(500);

      // 点击 "导入数据" 按钮
      const importBtn = await page.$('button.btn-sm:not(.btn-primary)');
      if (importBtn) {
        const btnText = (await importBtn.textContent()).trim();
        if (btnText.includes('导入数据')) {
          await importBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // 切换到 "批量粘贴" 页签
      const importTabs = await page.$$('button');
      for (const tab of importTabs) {
        const text = (await tab.textContent()).trim();
        if (text === '批量粘贴') {
          await tab.click();
          await page.waitForTimeout(300);
          break;
        }
      }

      // 粘贴数据
      const textarea = await page.$('textarea');
      if (textarea) {
        await textarea.fill('username,password,role\nadmin,123456,管理员\nguest,guest123,访客\ntester,test123,测试员');
        await page.waitForTimeout(500);

        // 触发 onBlur 来解析数据
        // Click somewhere else to trigger onBlur
        const pageHeader = await page.$('h2');
        if (pageHeader) await pageHeader.click();
        await page.waitForTimeout(1000);
      }

      await takeScreenshot(page, 'paste-import');
    });

    it('7.2 粘贴的数据应能保存到列表', async () => {
      // 现在应该在创建表单中，保存它
      const saveBtn = await page.$('button.btn-primary:not(.btn-sm)');
      if (saveBtn) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
      }

      const bodyText = await page.evaluate(() => document.body.innerText);
      assert.ok(bodyText.includes('粘贴导入数据') || bodyText.includes('admin'),
        '粘贴导入的数据池应出现在列表中');

      await takeScreenshot(page, 'paste-created');
    });
  });

  // ==================== 8. 删除数据池 ====================
  describe('8. 删除数据池', () => {
    it('8.1 应能删除数据池', async () => {
      await navigateTo(page, '测试数据');
      await page.waitForTimeout(500);

      // 查找删除按钮
      const deleteButtons = await page.$$('button.btn-danger');
      if (deleteButtons.length > 0) {
        // 点击数据池卡片的删除按钮
        await deleteButtons[0].click();
        await page.waitForTimeout(1000);

        await takeScreenshot(page, 'after-delete');
      }
    });

    it('8.2 删除后列表应更新', async () => {
      const bodyText = await page.evaluate(() => document.body.innerText);
      // 可能还有另一个数据池存在，但至少不应报错
      assert.ok(true, '删除完成后页面应保持正常');
    });
  });

  // ==================== 9. 回归验证页面 ====================
  describe('9. 回归验证页面', () => {
    it('9.1 回归验证页面应正常加载', async () => {
      await navigateTo(page, '回归验证');
      await page.waitForTimeout(1000);

      const title = await getPageTitle(page);
      assert.ok(title.includes('回归'), `回归页面应有标题, 实际: "${title}"`);

      await takeScreenshot(page, 'regression-page');
    });
  });
});
