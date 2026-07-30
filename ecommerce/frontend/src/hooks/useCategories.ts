import { categoryService } from '../services/categoryService'
import { useAsync } from './useAsync'

export function useCategories() {
  return useAsync(() => categoryService.list(), [])
}
