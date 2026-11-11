import { Route, Routes } from "react-router-dom";
import { PublicLayout, StaffLayout } from "./components/Layouts.jsx";
import RequireRole from "./auth/RequireRole.jsx";

import Home from "./pages/public/Home.jsx";
import Services from "./pages/public/Services.jsx";
import Login from "./pages/public/Login.jsx";
import Register from "./pages/public/Register.jsx";
import NotFound from "./pages/public/NotFound.jsx";

import BookService from "./pages/customer/BookService.jsx";
import MyBookings from "./pages/customer/MyBookings.jsx";
import BookingDetail from "./pages/customer/BookingDetail.jsx";
import MyRepairs from "./pages/customer/MyRepairs.jsx";
import RepairDetail from "./pages/customer/RepairDetail.jsx";
import MyPayments from "./pages/customer/MyPayments.jsx";
import Profile from "./pages/customer/Profile.jsx";

import TechJobs from "./pages/technician/TechJobs.jsx";
import TechJobDetail from "./pages/technician/TechJobDetail.jsx";
import TechParts from "./pages/technician/TechParts.jsx";

import Dashboard from "./pages/admin/Dashboard.jsx";
import AdminBookings from "./pages/admin/AdminBookings.jsx";
import AdminWorkOrders from "./pages/admin/AdminWorkOrders.jsx";
import WalkInNew from "./pages/admin/WalkInNew.jsx";
import AdminWorkOrderDetail from "./pages/admin/AdminWorkOrderDetail.jsx";
import AdminCatalog from "./pages/admin/AdminCatalog.jsx";
import AdminInventory from "./pages/admin/AdminInventory.jsx";
import AdminPayments from "./pages/admin/AdminPayments.jsx";

const customer = (el) => <RequireRole roles={["CUSTOMER"]}>{el}</RequireRole>;

export default function App() {
    return (
        <Routes>
            <Route element={<PublicLayout />}>
                <Route index element={<Home />} />
                <Route path="services" element={<Services />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route path="book" element={customer(<BookService />)} />
                <Route path="my/bookings" element={customer(<MyBookings />)} />
                <Route path="my/bookings/:bookingId" element={customer(<BookingDetail />)} />
                <Route path="my/repairs" element={customer(<MyRepairs />)} />
                <Route path="my/repairs/:workOrderId" element={customer(<RepairDetail />)} />
                <Route path="my/payments" element={customer(<MyPayments />)} />
                <Route path="my/profile" element={customer(<Profile />)} />
                <Route path="*" element={<NotFound />} />
            </Route>

            <Route path="tech" element={<RequireRole roles={["TECHNICIAN"]}><StaffLayout /></RequireRole>}>
                <Route index element={<TechJobs />} />
                <Route path="jobs/:workOrderId" element={<TechJobDetail />} />
                <Route path="parts" element={<TechParts />} />
            </Route>

            <Route path="admin" element={<RequireRole roles={["ADMIN"]}><StaffLayout /></RequireRole>}>
                <Route index element={<Dashboard />} />
                <Route path="bookings" element={<AdminBookings />} />
                <Route path="work-orders" element={<AdminWorkOrders />} />
                <Route path="work-orders/new" element={<WalkInNew />} />
                <Route path="work-orders/:workOrderId" element={<AdminWorkOrderDetail />} />
                <Route path="catalog" element={<AdminCatalog />} />
                <Route path="inventory" element={<AdminInventory />} />
                <Route path="payments" element={<AdminPayments />} />
            </Route>
        </Routes>
    );
}
