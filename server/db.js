const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "accounts.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      login_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      default_employee_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_companies (
      login_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      PRIMARY KEY (login_id, company_id),
      FOREIGN KEY (login_id) REFERENCES accounts(login_id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS employees (
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      PRIMARY KEY (company_id, employee_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS banks (
      company_id TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      PRIMARY KEY (company_id, bank_name),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      time TEXT NOT NULL,
      ref TEXT NOT NULL,
      in_amount REAL NOT NULL DEFAULT 0,
      out_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );
  `);

  migrateDatabase();

  const count = db.prepare("SELECT COUNT(*) AS total FROM companies").get().total;
  if (count === 0) {
    seedDatabase();
  }
}

function migrateDatabase() {
  const recordCols = db.prepare("PRAGMA table_info(records)").all().map((col) => col.name);
  const recordAdditions = [
    ["type", "TEXT DEFAULT 'In'"],
    ["bc", "TEXT DEFAULT ''"],
    ["category", "TEXT DEFAULT ''"],
    ["kiosk", "TEXT DEFAULT ''"],
    ["sid", "TEXT DEFAULT ''"],
    ["pid", "TEXT DEFAULT ''"],
    ["credit", "REAL DEFAULT 0"],
    ["rate", "REAL DEFAULT 0"],
    ["bonus", "REAL DEFAULT 0"],
    ["bonus_percent", "REAL DEFAULT 0"],
    ["tips", "REAL DEFAULT 0"],
    ["remark", "TEXT DEFAULT ''"],
    ["transaction_date", "TEXT DEFAULT ''"]
  ];

  recordAdditions.forEach(([column, definition]) => {
    if (!recordCols.includes(column)) {
      db.exec("ALTER TABLE records ADD COLUMN " + column + " " + definition);
    }
  });

  const bankCols = db.prepare("PRAGMA table_info(banks)").all().map((col) => col.name);
  if (!bankCols.includes("account_no")) {
    db.exec("ALTER TABLE banks ADD COLUMN account_no TEXT DEFAULT ''");
  }
}

function generateCompanyId() {
  const row = db.prepare("SELECT COUNT(*) AS total FROM companies").get();
  return "C" + String(row.total + 1).padStart(3, "0");
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function seedDatabase() {
  const now = new Date().toISOString();
  const c001Banks = [
    { name: "HQ (arrange EXP)", accountNo: "123" },
    { name: "WinFaPay", accountNo: "201" },
    { name: "WePay", accountNo: "202" },
    { name: "Onepay", accountNo: "203" },
    { name: "KIRAPay", accountNo: "204" },
    { name: "BANK TEAM LAIN", accountNo: "205" },
    { name: "1MPay", accountNo: "206" },
    { name: "HQ (accrual/prepayment)", accountNo: "207" },
    { name: "Novapay", accountNo: "208" }
  ];

  const insertCompany = db.prepare(
    "INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)"
  );
  const insertEmployee = db.prepare(
    "INSERT INTO employees (company_id, employee_id, name, role) VALUES (?, ?, ?, ?)"
  );
  const insertBank = db.prepare(
    "INSERT INTO banks (company_id, bank_name, account_no) VALUES (?, ?, ?)"
  );
  const insertAccount = db.prepare(
    "INSERT INTO accounts (login_id, password_hash, name, default_employee_id) VALUES (?, ?, ?, ?)"
  );
  const insertAccountCompany = db.prepare(
    "INSERT INTO account_companies (login_id, company_id, employee_id) VALUES (?, ?, ?)"
  );

  const seed = db.transaction(() => {
    insertCompany.run("C001", "GSWB", now);
    insertCompany.run("C002", "南方科技有限公司", now);

    insertEmployee.run("C001", "EMP001", "张三", "admin");
    insertEmployee.run("C001", "EMP002", "李四", "user");
    insertEmployee.run("C001", "EMP003", "王五", "user");
    insertEmployee.run("C002", "EMP001", "张三", "admin");

    c001Banks.forEach((bank) => insertBank.run("C001", bank.name, bank.accountNo));
    [
      { name: "中国银行", accountNo: "301" },
      { name: "工商银行", accountNo: "302" },
      { name: "建设银行", accountNo: "303" }
    ].forEach((bank) => insertBank.run("C002", bank.name, bank.accountNo));

    const adminHash = hashPassword("123456");
    const lisiHash = hashPassword("123456");

    insertAccount.run("admin", adminHash, "张三", "EMP001");
    insertAccount.run("lisi", lisiHash, "李四", "EMP002");

    insertAccountCompany.run("admin", "C001", "EMP001");
    insertAccountCompany.run("admin", "C002", "EMP001");
    insertAccountCompany.run("lisi", "C001", "EMP002");
  });

  seed();
}

function getAccountCompanies(loginId) {
  return db.prepare(`
    SELECT ac.company_id AS id, c.name, ac.employee_id AS employeeId
    FROM account_companies ac
    JOIN companies c ON c.id = ac.company_id
    WHERE ac.login_id = ?
    ORDER BY c.name
  `).all(loginId);
}

function getAccount(loginId) {
  return db.prepare("SELECT * FROM accounts WHERE login_id = ?").get(loginId);
}

function getCompany(companyId) {
  return db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId);
}

function userHasCompanyAccess(loginId, companyId) {
  const row = db.prepare(
    "SELECT 1 FROM account_companies WHERE login_id = ? AND company_id = ?"
  ).get(loginId, companyId);
  return Boolean(row);
}

function getEmployee(companyId, employeeId) {
  return db.prepare(
    "SELECT employee_id AS employeeId, name, role FROM employees WHERE company_id = ? AND employee_id = ?"
  ).get(companyId, employeeId);
}

function getCompanyDetails(companyId) {
  const company = getCompany(companyId);
  if (!company) {
    return null;
  }

  const employees = db.prepare(
    "SELECT employee_id AS employeeId, name, role FROM employees WHERE company_id = ? ORDER BY employee_id"
  ).all(companyId);

  const banks = db.prepare(
    "SELECT bank_name AS name, account_no AS accountNo FROM banks WHERE company_id = ? ORDER BY rowid"
  ).all(companyId);

  return {
    id: company.id,
    name: company.name,
    employees,
    banks
  };
}

function getBankInfo(companyId, bankName) {
  return db.prepare(
    "SELECT bank_name AS name, account_no AS accountNo FROM banks WHERE company_id = ? AND bank_name = ?"
  ).get(companyId, bankName);
}

function getBankBalance(companyId, bankName) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(in_amount), 0) - COALESCE(SUM(out_amount), 0) AS balance
    FROM records
    WHERE company_id = ? AND bank_name = ?
  `).get(companyId, bankName);
  return row ? row.balance : 0;
}

function createCompany({ name, creatorLoginId, creatorName, creatorEmployeeId }) {
  const companyId = generateCompanyId();
  const now = new Date().toISOString();
  const defaultBanks = [
    { name: "HQ (arrange EXP)", accountNo: "101" },
    { name: "WinFaPay", accountNo: "102" },
    { name: "WePay", accountNo: "103" }
  ];

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      companyId,
      name,
      now
    );

    db.prepare(
      "INSERT INTO employees (company_id, employee_id, name, role) VALUES (?, ?, ?, ?)"
    ).run(companyId, creatorEmployeeId, creatorName, "admin");

    defaultBanks.forEach((bank) => {
      db.prepare("INSERT INTO banks (company_id, bank_name, account_no) VALUES (?, ?, ?)").run(
        companyId,
        bank.name,
        bank.accountNo
      );
    });

    const existing = db.prepare(
      "SELECT 1 FROM account_companies WHERE login_id = ? AND company_id = ?"
    ).get(creatorLoginId, companyId);

    if (!existing) {
      db.prepare(
        "INSERT INTO account_companies (login_id, company_id, employee_id) VALUES (?, ?, ?)"
      ).run(creatorLoginId, companyId, creatorEmployeeId);
    }
  });

  tx();
  return getCompanyDetails(companyId);
}

function addEmployee(companyId, employeeId, name, role) {
  db.prepare(
    "INSERT INTO employees (company_id, employee_id, name, role) VALUES (?, ?, ?, ?)"
  ).run(companyId, employeeId, name, role);
}

function removeEmployee(companyId, employeeId) {
  db.prepare(
    "DELETE FROM employees WHERE company_id = ? AND employee_id = ?"
  ).run(companyId, employeeId);
}

function addBank(companyId, bankName, accountNo) {
  db.prepare("INSERT INTO banks (company_id, bank_name, account_no) VALUES (?, ?, ?)").run(
    companyId,
    bankName,
    accountNo || ""
  );
}

function removeBank(companyId, bankName) {
  db.prepare("DELETE FROM banks WHERE company_id = ? AND bank_name = ?").run(companyId, bankName);
}

function mapRecordRow(row) {
  return {
    id: row.id,
    time: row.time,
    ref: row.ref,
    inAmount: row.inAmount,
    outAmount: row.outAmount,
    type: row.type,
    bc: row.bc,
    category: row.category,
    kiosk: row.kiosk,
    sid: row.sid,
    pid: row.pid,
    credit: row.credit,
    rate: row.rate,
    bonus: row.bonus,
    bonusPercent: row.bonusPercent,
    tips: row.tips,
    remark: row.remark,
    transactionDate: row.transactionDate,
    employeeId: row.employeeId,
    employeeName: row.employeeName
  };
}

function getRecords(companyId, bankName) {
  const rows = db.prepare(`
    SELECT
      r.id,
      r.time,
      r.ref,
      r.in_amount AS inAmount,
      r.out_amount AS outAmount,
      r.type,
      r.bc,
      r.category,
      r.kiosk,
      r.sid,
      r.pid,
      r.credit,
      r.rate,
      r.bonus,
      r.bonus_percent AS bonusPercent,
      r.tips,
      r.remark,
      r.transaction_date AS transactionDate,
      r.employee_id AS employeeId,
      e.name AS employeeName
    FROM records r
    LEFT JOIN employees e ON e.company_id = r.company_id AND e.employee_id = r.employee_id
    WHERE r.company_id = ? AND r.bank_name = ?
    ORDER BY r.time DESC, r.id DESC
  `).all(companyId, bankName);

  return rows.map(mapRecordRow);
}

function getAllRecordsForCompany(companyId) {
  const rows = db.prepare(`
    SELECT
      r.id,
      r.bank_name AS bank,
      r.time,
      r.ref,
      r.in_amount AS inAmount,
      r.out_amount AS outAmount,
      r.type,
      r.bc,
      r.category,
      r.kiosk,
      r.sid,
      r.pid,
      r.credit,
      r.rate,
      r.bonus,
      r.bonus_percent AS bonusPercent,
      r.tips,
      r.remark,
      r.transaction_date AS transactionDate,
      r.employee_id AS employeeId,
      e.name AS employeeName
    FROM records r
    LEFT JOIN employees e ON e.company_id = r.company_id AND e.employee_id = r.employee_id
    WHERE r.company_id = ?
    ORDER BY r.time DESC, r.id DESC
  `).all(companyId);

  return rows.map(mapRecordRow);
}

function addRecord(companyId, employeeId, bankName, record) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO records (
      company_id, employee_id, bank_name, time, ref, in_amount, out_amount,
      type, bc, category, kiosk, sid, pid, credit, rate, bonus, bonus_percent,
      tips, remark, transaction_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId,
    employeeId,
    bankName,
    record.time,
    record.ref,
    record.inAmount,
    record.outAmount,
    record.type || "In",
    record.bc || "",
    record.category || "",
    record.kiosk || "",
    record.sid || "",
    record.pid || "",
    record.credit || 0,
    record.rate || 0,
    record.bonus || 0,
    record.bonusPercent || 0,
    record.tips || 0,
    record.remark || "",
    record.transactionDate || "",
    now
  );

  const rows = db.prepare(`
    SELECT
      r.id,
      r.time,
      r.ref,
      r.in_amount AS inAmount,
      r.out_amount AS outAmount,
      r.type,
      r.bc,
      r.category,
      r.kiosk,
      r.sid,
      r.pid,
      r.credit,
      r.rate,
      r.bonus,
      r.bonus_percent AS bonusPercent,
      r.tips,
      r.remark,
      r.transaction_date AS transactionDate,
      r.employee_id AS employeeId,
      e.name AS employeeName
    FROM records r
    LEFT JOIN employees e ON e.company_id = r.company_id AND e.employee_id = r.employee_id
    WHERE r.id = ?
  `).get(result.lastInsertRowid);

  return mapRecordRow(rows);
}

function deleteRecord(companyId, recordId) {
  return db.prepare(
    "DELETE FROM records WHERE id = ? AND company_id = ?"
  ).run(recordId, companyId).changes > 0;
}

function clearBankRecords(companyId, bankName) {
  db.prepare(
    "DELETE FROM records WHERE company_id = ? AND bank_name = ?"
  ).run(companyId, bankName);
}

function createAccount({ loginId, password, name, employeeId, companyId }) {
  db.prepare(
    "INSERT INTO accounts (login_id, password_hash, name, default_employee_id) VALUES (?, ?, ?, ?)"
  ).run(loginId, hashPassword(password), name, employeeId);

  db.prepare(
    "INSERT INTO account_companies (login_id, company_id, employee_id) VALUES (?, ?, ?)"
  ).run(loginId, companyId, employeeId);
}

initDatabase();

module.exports = {
  db,
  verifyPassword,
  getAccount,
  getAccountCompanies,
  getCompany,
  getCompanyDetails,
  userHasCompanyAccess,
  getEmployee,
  createCompany,
  addEmployee,
  removeEmployee,
  addBank,
  removeBank,
  getBankInfo,
  getBankBalance,
  getRecords,
  getAllRecordsForCompany,
  addRecord,
  deleteRecord,
  clearBankRecords,
  createAccount
};
