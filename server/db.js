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

  const count = db.prepare("SELECT COUNT(*) AS total FROM companies").get().total;
  if (count === 0) {
    seedDatabase();
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
  const defaultBanks = [
    "中国银行",
    "工商银行",
    "建设银行",
    "招商银行",
    "农业银行"
  ];

  const insertCompany = db.prepare(
    "INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)"
  );
  const insertEmployee = db.prepare(
    "INSERT INTO employees (company_id, employee_id, name, role) VALUES (?, ?, ?, ?)"
  );
  const insertBank = db.prepare(
    "INSERT INTO banks (company_id, bank_name) VALUES (?, ?)"
  );
  const insertAccount = db.prepare(
    "INSERT INTO accounts (login_id, password_hash, name, default_employee_id) VALUES (?, ?, ?, ?)"
  );
  const insertAccountCompany = db.prepare(
    "INSERT INTO account_companies (login_id, company_id, employee_id) VALUES (?, ?, ?)"
  );

  const seed = db.transaction(() => {
    insertCompany.run("C001", "华东贸易有限公司", now);
    insertCompany.run("C002", "南方科技有限公司", now);

    insertEmployee.run("C001", "EMP001", "张三", "admin");
    insertEmployee.run("C001", "EMP002", "李四", "user");
    insertEmployee.run("C001", "EMP003", "王五", "user");
    insertEmployee.run("C002", "EMP001", "张三", "admin");

    defaultBanks.forEach((bank) => insertBank.run("C001", bank));
    ["中国银行", "工商银行", "建设银行"].forEach((bank) => insertBank.run("C002", bank));

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
    "SELECT bank_name AS name FROM banks WHERE company_id = ? ORDER BY bank_name"
  ).all(companyId).map((row) => row.name);

  return {
    id: company.id,
    name: company.name,
    employees,
    banks
  };
}

function createCompany({ name, creatorLoginId, creatorName, creatorEmployeeId }) {
  const companyId = generateCompanyId();
  const now = new Date().toISOString();
  const defaultBanks = ["中国银行", "工商银行", "建设银行"];

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
      db.prepare("INSERT INTO banks (company_id, bank_name) VALUES (?, ?)").run(companyId, bank);
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

function addBank(companyId, bankName) {
  db.prepare("INSERT INTO banks (company_id, bank_name) VALUES (?, ?)").run(companyId, bankName);
}

function removeBank(companyId, bankName) {
  db.prepare("DELETE FROM banks WHERE company_id = ? AND bank_name = ?").run(companyId, bankName);
}

function getRecords(companyId, employeeId, bankName) {
  return db.prepare(`
    SELECT id, time, ref, in_amount AS inAmount, out_amount AS outAmount
    FROM records
    WHERE company_id = ? AND employee_id = ? AND bank_name = ?
    ORDER BY time DESC, id DESC
  `).all(companyId, employeeId, bankName);
}

function getAllRecordsForEmployee(companyId, employeeId) {
  return db.prepare(`
    SELECT id, bank_name AS bank, time, ref, in_amount AS inAmount, out_amount AS outAmount
    FROM records
    WHERE company_id = ? AND employee_id = ?
    ORDER BY time DESC, id DESC
  `).all(companyId, employeeId);
}

function addRecord(companyId, employeeId, bankName, record) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO records (company_id, employee_id, bank_name, time, ref, in_amount, out_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId,
    employeeId,
    bankName,
    record.time,
    record.ref,
    record.inAmount,
    record.outAmount,
    now
  );

  return {
    id: result.lastInsertRowid,
    time: record.time,
    ref: record.ref,
    inAmount: record.inAmount,
    outAmount: record.outAmount
  };
}

function deleteRecord(companyId, recordId, employeeId) {
  return db.prepare(
    "DELETE FROM records WHERE id = ? AND company_id = ? AND employee_id = ?"
  ).run(recordId, companyId, employeeId).changes > 0;
}

function clearBankRecords(companyId, employeeId, bankName) {
  db.prepare(
    "DELETE FROM records WHERE company_id = ? AND employee_id = ? AND bank_name = ?"
  ).run(companyId, employeeId, bankName);
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
  getRecords,
  getAllRecordsForEmployee,
  addRecord,
  deleteRecord,
  clearBankRecords,
  createAccount
};
