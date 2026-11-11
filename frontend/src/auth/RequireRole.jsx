import { Navigate, useLocation } from "react-router-dom";
import { homeFor, useAuth } from "./AuthProvider.jsx";

export default function RequireRole({ roles, children }) {
    const { user, role } = useAuth();
    const location = useLocation();
    if (!user) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
    if (!roles.includes(role)) {
        return <Navigate to={homeFor(role)} replace />;
    }
    return children;
}
