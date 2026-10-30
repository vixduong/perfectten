import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { HeadContent, Link, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { useEffect } from 'react'
import css from '../styles/phan.css?url'
import { meKey, supabase } from '../lib/supabase'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Điểm Mười: soạn đề và làm bài' },
      { name: 'description', content: 'Giáo viên soạn đề, giao bài cho lớp. Học sinh làm bài và xem kết quả.' },
    ],
    links: [
      { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&family=Patrick+Hand&display=swap' },
      { rel: 'stylesheet', href: css },
    ],
  }),
  shellComponent: Shell,
  component: Root,
  notFoundComponent: () => (
    <main className="page page--narrow stack">
      <h1>Không tìm thấy trang</h1>
      <Link to="/" className="btn">Về trang chủ</Link>
    </main>
  ),
})

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function Root() {
  const { queryClient } = Route.useRouteContext()
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'TOKEN_REFRESHED') queryClient.invalidateQueries({ queryKey: meKey })
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">
        <Outlet />
      </div>
    </QueryClientProvider>
  )
}
