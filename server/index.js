const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "company-accounts-dev-secret-change-in-production";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "请先登入。" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: "登入已过期，请重新登入。" });
  }
}

function requireCompanyAccess(req, res, next) {
  const companyId = req.params.companyId;
  if (!db.userHasCompanyAccess(req.user.loginId, companyId)) {
    return res.status(403).json({ error: "你没有权限访问该公司。" });
  }
  next();
}

function getUserEmployeeId(loginId, companyId) {
  const row = db.prepare(
    "SELECT employee_id FROM account_companies WHERE login_id = ? AND company_id = ?"
  ).get(loginId, companyId);
  return row ? row.employee_id : null;
}

function requireAdmin(req, res, next) {
  const companyId = req.params.companyId;
  const employeeId = getUserEmployeeId(req.user.loginId, companyId);
  const employee = employeeId ? db.getEmployee(companyId, employeeId) : null;
  if (!employee || employee.role !== "admin") {
    return res.status(403).json({ error: "只有管理员可以执行此操作。" });
  }
  req.companyEmployeeId = employeeId;
  next();
}

app.post("/api/login", (req, res) => {
  const loginId = String(req.body.loginId || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const account = db.getAccount(loginId);
  if (!account || !db.verifyPassword(password, account.password_hash)) {
    return res.status(401).json({ error: "登入账号或密码错误。" });
  }

  const companies = db.getAccountCompanies(loginId);
  const token = createToken({
    loginId,
    name: account.name,
    employeeId: account.default_employee_id
  });

  res.json({
    token,
    account: {
      loginId,
      name: account.name,
      employeeId: account.default_employee_id,
      companies
    }
  });
});

app.get("/api/me", authMiddleware, (req, res) => {
  const account = db.getAccount(req.user.loginId);
  if (!account) {
    return res.status(401).json({ error: "账号不存在。" });
  }

  res.json({
    loginId: req.user.loginId,
    name: account.name,
    employeeId: account.default_employee_id,
    companies: db.getAccountCompanies(req.user.loginId)
  });
});

app.get("/api/companies", authMiddleware, (req, res) => {
  res.json({ companies: db.getAccountCompanies(req.user.loginId) });
});

app.post("/api/companies", authMiddleware, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "请输入公司名称。" });
  }

  const account = db.getAccount(req.user.loginId);
  const company = db.createCompany({
    name,
    creatorLoginId: req.user.loginId,
    creatorName: account.name,
    creatorEmployeeId: account.default_employee_id
  });

  res.status(201).json({
    company,
    companies: db.getAccountCompanies(req.user.loginId)
  });
});

app.get("/api/companies/:companyId", authMiddleware, requireCompanyAccess, (req, res) => {
  const company = db.getCompanyDetails(req.params.companyId);
  if (!company) {
    return res.status(404).json({ error: "公司不存在。" });
  }

  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );

  res.json({
    company,
    employeeId: access ? access.employeeId : req.user.employeeId
  });
});

app.post("/api/companies/:companyId/employees", authMiddleware, requireCompanyAccess, requireAdmin, (req, res) => {
  const employeeId = String(req.body.employeeId || "").trim().toUpperCase();
  const name = String(req.body.name || "").trim();
  const role = req.body.role === "admin" ? "admin" : "user";

  if (!employeeId || !name) {
    return res.status(400).json({ error: "请填写员工号和姓名。" });
  }

  if (db.getEmployee(req.params.companyId, employeeId)) {
    return res.status(400).json({ error: "该员工号已存在。" });
  }

  db.addEmployee(req.params.companyId, employeeId, name, role);
  res.status(201).json({ company: db.getCompanyDetails(req.params.companyId) });
});

app.delete("/api/companies/:companyId/employees/:employeeId", authMiddleware, requireCompanyAccess, requireAdmin, (req, res) => {
  const employeeId = req.params.employeeId.toUpperCase();
  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );

  if (access && access.employeeId === employeeId) {
    return res.status(400).json({ error: "不能删除自己的员工档案。" });
  }

  db.removeEmployee(req.params.companyId, employeeId);
  res.json({ company: db.getCompanyDetails(req.params.companyId) });
});

app.post("/api/companies/:companyId/banks", authMiddleware, requireCompanyAccess, requireAdmin, (req, res) => {
  const bankName = String(req.body.bankName || "").trim();
  if (!bankName) {
    return res.status(400).json({ error: "请输入银行名称。" });
  }

  const company = db.getCompanyDetails(req.params.companyId);
  if (company.banks.includes(bankName)) {
    return res.status(400).json({ error: "该银行已存在。" });
  }

  db.addBank(req.params.companyId, bankName);
  res.status(201).json({ company: db.getCompanyDetails(req.params.companyId) });
});

app.delete("/api/companies/:companyId/banks/:bankName", authMiddleware, requireCompanyAccess, requireAdmin, (req, res) => {
  const company = db.getCompanyDetails(req.params.companyId);
  if (company.banks.length <= 1) {
    return res.status(400).json({ error: "至少需要保留一家银行。" });
  }

  db.removeBank(req.params.companyId, decodeURIComponent(req.params.bankName));
  res.json({ company: db.getCompanyDetails(req.params.companyId) });
});

app.get("/api/companies/:companyId/records", authMiddleware, requireCompanyAccess, (req, res) => {
  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );
  const employeeId = access.employeeId;
  const bankName = String(req.query.bank || "");

  if (!bankName) {
    return res.status(400).json({ error: "请指定银行。" });
  }

  res.json({ records: db.getRecords(req.params.companyId, employeeId, bankName) });
});

app.get("/api/companies/:companyId/records/all", authMiddleware, requireCompanyAccess, (req, res) => {
  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );

  res.json({
    records: db.getAllRecordsForEmployee(req.params.companyId, access.employeeId)
  });
});

app.post("/api/companies/:companyId/records", authMiddleware, requireCompanyAccess, (req, res) => {
  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );
  const bankName = String(req.body.bank || "").trim();
  const inAmount = Number(req.body.inAmount || 0);
  const outAmount = Number(req.body.outAmount || 0);

  if (!bankName) {
    return res.status(400).json({ error: "请选择银行。" });
  }

  if (inAmount === 0 && outAmount === 0) {
    return res.status(400).json({ error: "In 和 Out 至少填写一项。" });
  }

  const record = db.addRecord(req.params.companyId, access.employeeId, bankName, {
    time: String(req.body.time || ""),
    ref: String(req.body.ref || "").trim(),
    inAmount,
    outAmount
  });

  res.status(201).json({ record });
});

app.delete("/api/companies/:companyId/records/:recordId", authMiddleware, requireCompanyAccess, (req, res) => {
  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );

  const deleted = db.deleteRecord(
    req.params.companyId,
    Number(req.params.recordId),
    access.employeeId
  );

  if (!deleted) {
    return res.status(404).json({ error: "记录不存在。" });
  }

  res.json({ success: true });
});

app.delete("/api/companies/:companyId/records/bank/:bankName", authMiddleware, requireCompanyAccess, (req, res) => {
  const access = db.getAccountCompanies(req.user.loginId).find(
    (item) => item.id === req.params.companyId
  );

  db.clearBankRecords(
    req.params.companyId,
    access.employeeId,
    decodeURIComponent(req.params.bankName)
  );

  res.json({ success: true });
});

app.post("/api/accounts", authMiddleware, (req, res) => {
  const companyId = String(req.body.companyId || "");
  if (!companyId || !db.userHasCompanyAccess(req.user.loginId, companyId)) {
    return res.status(403).json({ error: "你没有权限在此公司创建账号。" });
  }

  const adminEmployeeId = getUserEmployeeId(req.user.loginId, companyId);
  const employee = adminEmployeeId ? db.getEmployee(companyId, adminEmployeeId) : null;
  if (!employee || employee.role !== "admin") {
    return res.status(403).json({ error: "只有管理员可以创建登入账号。" });
  }

  const loginId = String(req.body.loginId || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const employeeId = String(req.body.employeeId || "").trim().toUpperCase();

  if (!loginId || !password || !employeeId) {
    return res.status(400).json({ error: "请填写完整信息。" });
  }

  if (db.getAccount(loginId)) {
    return res.status(400).json({ error: "该登入账号已存在。" });
  }

  const targetEmployee = db.getEmployee(companyId, employeeId);
  if (!targetEmployee) {
    return res.status(400).json({ error: "请先在该公司添加该员工号。" });
  }

  db.createAccount({
    loginId,
    password,
    name: targetEmployee.name,
    employeeId,
    companyId
  });

  res.status(201).json({ success: true, loginId });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log("公司账目管理系统已启动: http://localhost:" + PORT);
});
