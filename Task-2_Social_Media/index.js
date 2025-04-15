const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_API_URL = 'http://20.244.56.144/evaluation-service';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiZXhwIjoxNzQ0NzAyODQyLCJpYXQiOjE3NDQ3MDI1NDIsImlzcyI6IkFmZm9yZG1lZCIsImp0aSI6IjIzMzBhZDM2LWUyNTgtNGQ1Mi05ODhlLWJjNTUxMmZiZGI2ZiIsInN1YiI6ImthcmFua3VtYXJnYXJnMTYxMEBnbWFpbC5jb20ifSwiZW1haWwiOiJrYXJhbmt1bWFyZ2FyZzE2MTBAZ21haWwuY29tIiwibmFtZSI6ImthcmFuIiwicm9sbE5vIjoiMjIxMDk5MDQ3OCIsImFjY2Vzc0NvZGUiOiJQd3p1ZkciLCJjbGllbnRJRCI6IjIzMzBhZDM2LWUyNTgtNGQ1Mi05ODhlLWJjNTUxMmZiZGI2ZiIsImNsaWVudFNlY3JldCI6Im1hQmVGQ054dlpEelZCVFQifQ.rmXFfuloljWVdAlBqIOWL2pJp2M5wX-nXenPvEz8KCY';

app.use(express.json());

const cache = {
  users: null,
  userPostsCache: {},
  postCommentsCache: {},
  lastFetched: {
    users: null,
    posts: {},
    comments: {}
  }
};

const CACHE_TTL = 5 * 60 * 1000;

const isCacheValid = (key) => {
  return cache.lastFetched[key] && (Date.now() - cache.lastFetched[key]) < CACHE_TTL;
};

async function fetchAllUsers() {
  if (cache.users && isCacheValid('users')) {
    return cache.users;
  }

  try {
    const response = await axios.get(`${BASE_API_URL}/users`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    cache.users = response.data.users;
    cache.lastFetched.users = Date.now();
    return cache.users;
  } catch (error) {
    throw new Error('Failed to fetch users from API');
  }
}

async function fetchUserPosts(userId) {
  if (cache.userPostsCache[userId] && isCacheValid(`posts.${userId}`)) {
    return cache.userPostsCache[userId];
  }

  try {
    const response = await axios.get(`${BASE_API_URL}/users/${userId}/posts`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    cache.userPostsCache[userId] = response.data.posts;
    cache.lastFetched.posts[userId] = Date.now();
    return response.data.posts;
  } catch (error) {
    throw new Error(`Failed to fetch posts for user ${userId}`);
  }
}

async function fetchPostComments(postId) {
  if (cache.postCommentsCache[postId] && isCacheValid(`comments.${postId}`)) {
    return cache.postCommentsCache[postId];
  }

  try {
    const response = await axios.get(`${BASE_API_URL}/posts/${postId}/comments`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    cache.postCommentsCache[postId] = response.data.comments;
    cache.lastFetched.comments[postId] = Date.now();
    return response.data.comments;
  } catch (error) {
    return [];
  }
}

app.get('/users', async (req, res) => {
  try {
    const users = await fetchAllUsers();
    const userCommentCounts = {};

    for (const [userId, userName] of Object.entries(users)) {
      userCommentCounts[userId] = {
        userId,
        userName,
        totalComments: 0
      };

      const posts = await fetchUserPosts(userId);

      for (const post of posts) {
        const comments = await fetchPostComments(post.id);
        userCommentCounts[userId].totalComments += comments.length;
      }
    }

    const sortedUsers = Object.values(userCommentCounts)
      .sort((a, b) => b.totalComments - a.totalComments)
      .slice(0, 5);

    res.json({
      topUsers: sortedUsers.map(user => ({
        userId: user.userId,
        userName: user.userName,
        commentCount: user.totalComments
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve top users' });
  }
});

app.get('/posts', async (req, res) => {
  const type = req.query.type || 'popular';

  try {
    const users = await fetchAllUsers();
    const allPosts = [];

    for (const userId of Object.keys(users)) {
      const userPosts = await fetchUserPosts(userId);

      for (const post of userPosts) {
        const comments = await fetchPostComments(post.id);

        allPosts.push({
          id: post.id,
          userId: post.userId,
          userName: users[post.userId],
          content: post.content,
          commentCount: comments.length,
          timestamp: post.id
        });
      }
    }

    let result;
    if (type === 'latest') {
      result = allPosts
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
    } else {
      result = allPosts
        .sort((a, b) => b.commentCount - a.commentCount)
        .slice(0, 5);
    }

    res.json({
      posts: result.map(post => ({
        postId: post.id,
        userId: post.userId,
        userName: post.userName,
        content: post.content,
        commentCount: post.commentCount
      }))
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to retrieve ${type} posts` });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    process.exit(0);
  });
});
