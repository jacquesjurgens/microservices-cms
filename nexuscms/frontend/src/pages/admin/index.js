// frontend/src/pages/admin/index.js
import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import axios from 'axios';

// Configuration
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contentTypes, setContentTypes] = useState([]);
  const [stats, setStats] = useState({
    totalPages: 0,
    totalPosts: 0,
    totalUsers: 0
  });

  useEffect(() => {
    // Check authentication
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.replace('/admin/login');
      return;
    }

    const fetchDashboardData = async () => {
      try {
        // Setup axios with token
        const authAxios = axios.create({
          baseURL: API_URL,
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        // Fetch current user
        const userResponse = await authAxios.get('/auth/me');
        setUser(userResponse.data.user);

        // Fetch content types
        const contentTypesResponse = await authAxios.get('/content/content-types');
        setContentTypes(contentTypesResponse.data.contentTypes || []);

        // Fetch stats (in a real app, this might be a dedicated endpoint)
        // For now, we'll simulate it with separate requests
        const pageType = contentTypesResponse.data.contentTypes.find(ct => ct.name === 'page');
        const blogType = contentTypesResponse.data.contentTypes.find(ct => ct.name === 'blog_post');

        if (pageType) {
          const pagesResponse = await authAxios.get(`/content/content-types/${pageType.id}/entries?limit=1`);
          setStats(prev => ({ ...prev, totalPages: pagesResponse.data.pagination.total }));
        }

        if (blogType) {
          const postsResponse = await authAxios.get(`/content/content-types/${blogType.id}/entries?limit=1`);
          setStats(prev => ({ ...prev, totalPosts: postsResponse.data.pagination.total }));
        }

        // Only admin can see users count
        if (userResponse.data.user.roles.includes('admin')) {
          const usersResponse = await authAxios.get('/auth/users');
          setStats(prev => ({ ...prev, totalUsers: usersResponse.data.users.length }));
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        // If unauthorized, redirect to login
        if (err.response && err.response.status === 401) {
          localStorage.removeItem('auth_token');
          router.replace('/admin/login');
        }
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    router.replace('/admin/login');
  };

  if (loading) {
    return <div className="container mx-auto p-4 text-center mt-8">Loading...</div>;
  }

  return (
    <div>
      <Head>
        <title>Admin Dashboard | Microservices CMS</title>
      </Head>

      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-2 flex justify-between items-center">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">Microservices CMS</h1>
              <span className="ml-2 px-2 py-1 bg-gray-100 rounded text-xs">Admin</span>
            </div>
            <div className="flex items-center">
              <span className="mr-4">{user?.username}</span>
              <button 
                onClick={handleLogout}
                className="px-3 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
              >
                Logout
              </button>
            </div>
          </div>
        </nav>

        <div className="container mx-auto p-4 grid grid-cols-12 gap-4">
          {/* Sidebar */}
          <div className="col-span-3">
            <div className="bg-white p-4 rounded shadow">
              <ul className="space-y-2">
                <li>
                  <Link href="/admin">
                    <a className="block p-2 bg-blue-50 text-blue-600 rounded">Dashboard</a>
                  </Link>
                </li>
                <li>
                  <Link href="/admin/content">
                    <a className="block p-2 hover:bg-gray-50 rounded">Content</a>
                  </Link>
                </li>
                {user?.roles.includes('admin') && (
                  <li>
                    <Link href="/admin/users">
                      <a className="block p-2 hover:bg-gray-50 rounded">Users</a>
                    </Link>
                  </li>
                )}
                <li>
                  <Link href="/admin/profile">
                    <a className="block p-2 hover:bg-gray-50 rounded">My Profile</a>
                  </Link>
                </li>
                <li>
                  <Link href="/">
                    <a className="block p-2 hover:bg-gray-50 rounded">View Website</a>
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Main Content */}
          <div className="col-span-9">
            <h2 className="text-2xl font-bold mb-4">Dashboard</h2>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white p-4 rounded shadow">
                <h3 className="text-lg font-semibold text-gray-500">Pages</h3>
                <p className="text-3xl font-bold">{stats.totalPages}</p>
                <Link href="/admin/content?type=page">
                  <a className="text-blue-500 text-sm hover:underline">View all pages</a>
                </Link>
              </div>
              <div className="bg-white p-4 rounded shadow">
                <h3 className="text-lg font-semibold text-gray-500">Blog Posts</h3>
                <p className="text-3xl font-bold">{stats.totalPosts}</p>
                <Link href="/admin/content?type=blog_post">
                  <a className="text-blue-500 text-sm hover:underline">View all posts</a>
                </Link>
              </div>
              {user?.roles.includes('admin') && (
                <div className="bg-white p-4 rounded shadow">
                  <h3 className="text-lg font-semibold text-gray-500">Users</h3>
                  <p className="text-3xl font-bold">{stats.totalUsers}</p>
                  <Link href="/admin/users">
                    <a className="text-blue-500 text-sm hover:underline">Manage users</a>
                  </Link>
                </div>
              )}
            </div>

            {/* Content Types Section */}
            <div className="bg-white p-4 rounded shadow mb-6">
              <h3 className="text-xl font-semibold mb-4">Content Types</h3>
              <div className="overflow-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {contentTypes.map((contentType) => (
                      <tr key={contentType.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{contentType.name}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-500">{contentType.description}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <Link href={`/admin/content?type=${contentType.name}`}>
                            <a className="text-blue-600 hover:text-blue-900 mr-3">View Content</a>
                          </Link>
                          {user?.roles.includes('admin') && (
                            <Link href={`/admin/content-types/${contentType.id}/edit`}>
                              <a className="text-indigo-600 hover:text-indigo-900">Edit Type</a>
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white p-4 rounded shadow">
              <h3 className="text-xl font-semibold mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link href="/admin/content/create?type=page">
                  <a className="p-3 bg-blue-50 text-blue-600 rounded text-center hover:bg-blue-100">
                    Create Page
                  </a>
                </Link>
                <Link href="/admin/content/create?type=blog_post">
                  <a className="p-3 bg-green-50 text-green-600 rounded text-center hover:bg-green-100">
                    Create Blog Post
                  </a>
                </Link>
                {user?.roles.includes('admin') && (
                  <>
                    <Link href="/admin/users/create">
                      <a className="p-3 bg-purple-50 text-purple-600 rounded text-center hover:bg-purple-100">
                        Add User
                      </a>
                    </Link>
                    <Link href="/admin/content-types/create">
                      <a className="p-3 bg-yellow-50 text-yellow-600 rounded text-center hover:bg-yellow-100">
                        New Content Type
                      </a>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
