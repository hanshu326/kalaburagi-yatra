import { api, session } from './api.js';

const CART_KEY = 'ky.cart';

export const state = {
  user: null,
  cart: new Set(),
  justPaid: null, // bookings from the payment that just completed
  listeners: new Set(),
};

export const onChange = (fn) => state.listeners.add(fn);
const emit = () => state.listeners.forEach((fn) => fn());

try {
  const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  if (Array.isArray(saved)) saved.forEach((id) => state.cart.add(Number(id)));
} catch { /* ignore */ }

function persistCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch { /* ignore */ }
  emit();
}

export function toggleCircuit(id) {
  state.cart.has(id) ? state.cart.delete(id) : state.cart.add(id);
  persistCart();
}

export function clearCart() {
  state.cart.clear();
  persistCart();
}

export async function loadUser() {
  if (!session.token) { state.user = null; return; }
  try {
    state.user = (await api.get('/auth/me')).user;
  } catch {
    session.token = null;
    state.user = null;
  }
}

export function setSession({ token, user }) {
  session.token = token;
  state.user = user;
  emit();
}

export function signOut() {
  session.token = null;
  state.user = null;
  state.justPaid = null;
  emit();
}

export const go = (path) => { location.hash = `#${path}`; };
