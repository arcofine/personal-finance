import { NavLink, Route, Routes } from "react-router-dom";
import { OverviewPage } from "./pages/OverviewPage";
import { AccountsPage } from "./pages/AccountsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ImportPage } from "./pages/ImportPage";
import { BudgetPage } from "./pages/BudgetPage";
import { CategorySpendPage } from "./pages/CategorySpendPage";
import { BackupPage } from "./pages/BackupPage";

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          Personal<span>Finance</span>
        </div>
        <nav className="nav">
          <NavLink to="/overview">Overview</NavLink>
          <NavLink to="/" end>
            Accounts
          </NavLink>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/budget">Budget</NavLink>
          <NavLink to="/spend">Category spend</NavLink>
          <NavLink to="/backup">Backup</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/" element={<AccountsPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/:accountId" element={<RegisterPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/spend" element={<CategorySpendPage />} />
        <Route path="/backup" element={<BackupPage />} />
      </Routes>
    </div>
  );
}
