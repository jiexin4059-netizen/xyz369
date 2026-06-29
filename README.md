# Bank Input · 公司账目管理系统

云端多人版账目管理系统，界面参照 **Bank Input** 专业布局设计。

## 界面功能

- **顶部栏**：Company 公司选择、Transaction Date 交易日期
- **银行标签页**：横向切换不同银行/支付账户（如 HQ、WinFaPay、WePay 等）
- **账户信息**：Bank Account No、Name、Balance
- **中间表格**：Time、Reference、In、Out、Type、BC、Category、Kiosk、SID、PID、Credit、Rate、Bonus、Tips、Remark、Employee
- **右侧表单**：New Transaction 录入区，支持 In/Out 切换

## 快速开始

```bash
npm install
npm start
```

浏览器打开 http://localhost:3000

## 演示账号

| 登入账号 | 密码 |
|----------|------|
| admin | 123456 |
| lisi | 123456 |

## 部署到云端

部署到云服务器后，同事访问同一网址即可共用数据。生产环境请设置：

```bash
export JWT_SECRET=你的随机密钥
```

## 项目结构

```
public/index.html   # Bank Input 界面
server/index.js     # API 服务器
server/db.js        # SQLite 数据库
data/accounts.db    # 数据文件（自动创建）
```
