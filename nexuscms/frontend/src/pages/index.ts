// frontend/src/pages/index.js
import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';

// Configuration
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export default function Home() {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchHomePage = async () => {
      try {
        // Get the homepage content
        const response = await axios.get(`${API_URL}/content/content-types/1/entries/slug/home`);
        setPage(response.data.entry);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching homepage:', err);
        setError('Failed to load homepage content. Please try again later.');
        setLoading(false);
      }
    };

    fetchHomePage();
  }, []);

  if (loading) {
    return <div className="container mx-auto p-4 text-center mt-8">Loading...</div>;
  }

  if (error) {
    return <div className="container mx-auto p-4 text-center mt-8 text-red-500">{error}</div>;
  }

  return (
    <div>
      <Head>
        <title>{page?.title || 'Home'} | Microservices CMS</title>
        <meta name="description" content={page?.data?.meta_description || 'Welcome to our Microservices CMS'} />
      </Head>

      <main className="container mx-auto p-4">
        {page ? (
          <div>
            <h1 className="text-3xl font-bold mb-4">{page.title}</h1>
            <div className="content" dangerouslySetInnerHTML={{ __html: page.data.content }} />
          </div>
        ) : (
          <div>
            <h1 className="text-3xl font-bold mb-4">Welcome to Microservices CMS</h1>
            <p>No content found. Please create a homepage in the admin panel.</p>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-2">Recent Blog Posts</h2>
          <BlogPostList />
        </div>
      </main>

      <footer className="bg-gray-100 p-4 mt-8">
        <div className="container mx-auto text-center">
          <p>&copy; {new Date().getFullYear()} Microservices CMS</p>
        </div>
      </footer>
    </div>
  );
}

function BlogPostList() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBlogPosts = async () => {
      try {
        // Get blog posts
        const response = await axios.get(
          `${API_URL}/content/content-types/2/entries?status=published&limit=3&orderBy=published_at&order=DESC`
        );
        setPosts(response.data.entries || []);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching blog posts:', err);
        setLoading(false);
      }
    };

    fetchBlogPosts();
  }, []);

  if (loading) {
    return <p>Loading posts...</p>;
  }

  if (posts.length === 0) {
    return <p>No blog posts found.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {posts.map((post) => (
        <div key={post.id} className="border p-4 rounded-lg">
          <h3 className="text-xl font-semibold mb-2">{post.title}</h3>
          <p className="text-gray-600 mb-2">
            {new Date(post.published_at).toLocaleDateString()}
          </p>
          {post.data.excerpt && <p className="mb-4">{post.data.excerpt}</p>}
          <Link href={`/blog/${post.slug}`}>
            <a className="text-blue-500 hover:underline">Read more</a>
          </Link>
        </div>
      ))}
    </div>
  );
}
