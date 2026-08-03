import CartDrawer from './CartDrawer'

// Header cart button and floating FAB were removed from the client vitrine.
// This component only mounts the sacola drawer so "Ver sacola" / add-to-cart
// flows that call openDrawer still work. Bottom-nav Sacola goes to /checkout.
export default function CartFab() {
  return <CartDrawer />
}
