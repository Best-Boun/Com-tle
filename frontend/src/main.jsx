import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/ticket.css";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/I18nProvider.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx";
import { ToastProvider } from "./components/ui.jsx";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <BrowserRouter>
            <I18nProvider>
                <AuthProvider>
                    <ToastProvider>
                        <App />
                    </ToastProvider>
                </AuthProvider>
            </I18nProvider>
        </BrowserRouter>
    </StrictMode>
);
