"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BlogPost {
  id: number;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  date: string;
  tags: string[];
  category: string;
}

const mockBlogPosts: BlogPost[] = [
  {
    id: 1,
    title: "Getting Started with React Hooks",
    excerpt: "Learn the fundamentals of React Hooks and how they can simplify your components.",
    content: "React Hooks have revolutionized how we write React components...",
    author: "Sarah Chen",
    date: "2024-03-15",
    tags: ["React", "JavaScript", "Frontend"],
    category: "Development",
  },
  {
    id: 2,
    title: "Building Scalable APIs with Node.js",
    excerpt: "Best practices for creating robust and scalable REST APIs using Node.js and Express.",
    content: "When building APIs that need to handle millions of requests...",
    author: "Mike Johnson",
    date: "2024-03-12",
    tags: ["Node.js", "API", "Backend"],
    category: "Development",
  },
  {
    id: 3,
    title: "CSS Grid vs Flexbox: When to Use Which",
    excerpt: "A comprehensive guide to choosing between CSS Grid and Flexbox for your layouts.",
    content: "Both CSS Grid and Flexbox are powerful layout tools...",
    author: "Emily Davis",
    date: "2024-03-10",
    tags: ["CSS", "Design", "Frontend"],
    category: "Design",
  },
  {
    id: 4,
    title: "Introduction to TypeScript Generics",
    excerpt: "Master TypeScript generics to write more flexible and reusable code.",
    content: "Generics are one of TypeScript's most powerful features...",
    author: "David Kim",
    date: "2024-03-08",
    tags: ["TypeScript", "JavaScript", "Development"],
    category: "Development",
  },
  {
    id: 5,
    title: "DevOps Essentials for Frontend Developers",
    excerpt: "Key DevOps concepts every frontend developer should know in 2024.",
    content: "DevOps isn't just for backend engineers anymore...",
    author: "Lisa Wang",
    date: "2024-03-05",
    tags: ["DevOps", "CI/CD", "Frontend"],
    category: "DevOps",
  },
  {
    id: 6,
    title: "The Art of Accessible Web Design",
    excerpt: "Creating inclusive web experiences that work for everyone.",
    content: "Accessibility isn't just a checkbox—it's about creating...",
    author: "Alex Rivera",
    date: "2024-03-01",
    tags: ["Accessibility", "Design", "UX"],
    category: "Design",
  },
  {
    id: 7,
    title: "GraphQL vs REST: Making the Right Choice",
    excerpt: "Comparing GraphQL and REST to help you choose the right API architecture.",
    content: "The debate between GraphQL and REST continues...",
    author: "Tom Anderson",
    date: "2024-02-28",
    tags: ["GraphQL", "REST", "API"],
    category: "Development",
  },
  {
    id: 8,
    title: "State Management in 2024: Beyond Redux",
    excerpt: "Exploring modern alternatives for managing state in React applications.",
    content: "While Redux remains popular, newer solutions like Zustand...",
    author: "Rachel Green",
    date: "2024-02-25",
    tags: ["React", "State Management", "Frontend"],
    category: "Development",
  },
];

export default function BlogSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(mockBlogPosts.map((post) => post.category));
    return Array.from(cats);
  }, []);

  const filteredPosts = useMemo(() => {
    return mockBlogPosts.filter((post) => {
      const matchesSearch =
        searchQuery === "" ||
        post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCategory =
        selectedCategory === null || post.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
            Blog Search
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Search through our collection of development articles
          </p>
        </div>

        <div className="mb-8 space-y-4">
          <Input
            type="text"
            placeholder="Search by title, content, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />

          <div className="flex flex-wrap gap-2">
            <Badge
              variant={selectedCategory === null ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Badge>
            {categories.map((category) => (
              <Badge
                key={category}
                variant={selectedCategory === category ? "default" : "secondary"}
                className="cursor-pointer"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
        </div>

        <div className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Showing {filteredPosts.length} of {mockBlogPosts.length} posts
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {filteredPosts.map((post) => (
            <Card key={post.id} className="cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
              <CardHeader>
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline">{post.category}</Badge>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{post.date}</span>
                </div>
                <CardTitle className="text-xl">{post.title}</CardTitle>
                <CardDescription>{post.excerpt}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-1">
                  {post.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  By {post.author}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredPosts.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              No posts found matching your search.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
