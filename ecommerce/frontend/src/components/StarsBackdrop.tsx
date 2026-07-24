import './StarsBackdrop.css'

// Uiverse.io by amir_6539 — ver StarsBackdrop.css pra explicação da
// adaptação (id -> class, sem duplicar as listas de box-shadow no
// ::after, sem o #title da referência).
export default function StarsBackdrop() {
  return (
    <div className="sunset-stars-container">
      <div className="sunset-st-stars" />
      <div className="sunset-st-stars2" />
      <div className="sunset-st-stars3" />
    </div>
  )
}
