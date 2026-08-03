import CartDrawer from './CartDrawer'

// Mounts the sacola drawer for openDrawer callers ("Ver sacola" / add-to-cart).
// Floating FAB was removed; header bag icon opens the drawer. Bottom-nav
// Sacola still goes to /checkout.
export default function CartFab() {
  return <CartDrawer />
}
