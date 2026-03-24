import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getUsers,
  getCurrentUser,
  updateCurrentUser,
  changePassword,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
} from '@/services/api'
import type { UpdateUserData, PatchMeData, ChangePasswordData, CreateUserData } from '@/types'

export function useUsers(params?: { collection_id?: string }) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => getUsers(params),
    staleTime: 60_000,
  })
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: getCurrentUser,
    staleTime: 30_000,
  })
}

export function useUpdateCurrentUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PatchMeData) => updateCurrentUser(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'me'] }),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: ChangePasswordData) => changePassword(data),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateUserData) => createUser(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserData }) => updateUser(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      resetUserPassword(id, password),
  })
}
