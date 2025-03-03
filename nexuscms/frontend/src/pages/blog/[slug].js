// frontend/src/pages/blog/[slug].js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';

// Configuration
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export default function BlogPost() {
  const router = useRouter();
  const { slug } = router.query;

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) return;

    const fetchBlogPost = async () => {
      try {
        // Get the blog post content
        const response = await axios.get(`${API_URL}/content/content-types/2/entries/slug/${slug}`);
        setPost(response.data.entry);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching blog post:', err);
        setError('Failed to load blog post. Please try again later.');
        setLoading(false);
      }
    };

    fetchBlogPost();
  }, [slug]);

  if (loading) {
    return <div className="container mx-auto p-4 text-center mt-8">Loading...</div>;
  }

  if (error) {
    return <div className="container mx-auto p-4 text-center mt-8 text-red-500">{error}</div>;
  }

  if (!post) {
    return (
      <div className="container mx-auto p-4 text-center mt-8">
        <p>Blog post not found.</p>
        <Link href="/blog">
          <a className="text-blue-500 hover:underline">Back to blog</a>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Head>
        <title>{post.title} | Blog | Microservices CMS</title>
        <meta name="description" content={post.data.excerpt || `Read ${post.title}`} />
      </Head>

      <main className="container mx-auto p-4 max-w-3xl">
        <Link href="/blog">
          <a className="text-blue-500 hover:underline mb-4 inline-block">← Back to blog</a>
        </Link>

        <article className="mt-6">
          <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
          
          <div className="text-gray-600 mb-6">
            <p>Published on {new Date(post.published_at).toLocaleDateString()}</p>
            {post.data.category && <p>Category: {post.data.category}</p>}
          </div>

          {post.data.featured_image && (
            <div className="mb-6">
              <img 
                src={post.data.featured_image} 
                alt={post.title}
                className="w-full h-auto rounded-lg" 
              />
            </div>
          )}

          <div 
            className="content prose lg:prose-xl"
            dangerouslySetInnerHTML={{ __html: post.data.content }}
          />

          {post.data.tags && post.data.tags.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold mb-2">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {post.data.tags.map((tag, index) => (
                  <span 
                    key={index}
                    className="bg-gray-100 px-3 py-1 rounded-full text-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </article>
      </main>

      <footer className="bg-gray-100 p-4 mt-8">
        <div className="container mx-auto text-center">
          <p>&copy; {new Date().getFullYear()} Microservices CMS</p>
        </div>
      </footer>
    </div>
  );
}
