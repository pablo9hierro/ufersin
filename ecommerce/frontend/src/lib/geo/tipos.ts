export interface Ponto {
  lat: number
  lng: number
}

export interface EnderecoResultado extends Ponto {
  titulo: string
  subtitulo: string
  bairro?: string
}

export interface Rota {
  coords: [number, number][]
  km: number
  min: number
}
