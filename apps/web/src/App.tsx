import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { OverviewPage } from "./pages/OverviewPage";
import { AccountsPage } from "./pages/AccountsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ImportPage } from "./pages/ImportPage";
import { BudgetPage } from "./pages/BudgetPage";
import { YearPage } from "./pages/YearPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { GroupsPage } from "./pages/GroupsPage";
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
          <NavLink to="/budget">Budget</NavLink>
          <NavLink to="/year">Year</NavLink>
          <NavLink to="/spend">Category spend</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          <NavLink to="/backup">Backup</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/" element={<AccountsPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/:accountId" element={<RegisterPage />} />
        <Route path="/import" element={<Navigate to="/settings/import" replace />} />
        <Route path="/categories" element={<Navigate to="/settings/categories" replace />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/year" element={<YearPage />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="import" replace />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="groups" element={<GroupsPage />} />
        </Route>
        <Route path="/spend" element={<CategorySpendPage />} />
        <Route path="/backup" element={<BackupPage />} />
      </Routes>
    </div>
  );
}

function SettingsLayout() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Statement import, category groups, and the categories under them.</p>
        </div>
      </div>
      <nav className="settings-nav" aria-label="Settings">
        <NavLink to="/settings/import">Import</NavLink>
        <NavLink to="/settings/categories">Categories</NavLink>
        <NavLink to="/settings/groups">Groups</NavLink>
      </nav>
      <Outlet />
    </>
  );
}
