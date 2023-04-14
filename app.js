const express = require("express");
const app = express();
app.use(express.json());
const jwt = require("jsonwebtoken");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const path = require("path");
const dbpath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBandServer = async (request, response) => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBandServer();

const validatePassword = (password) => {
  return password.length > 6;
};

//register user
app.post("/register", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getdbuserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbuser = await db.get(getdbuserQuery);
  if (dbuser === undefined) {
    if (validatePassword(password)) {
      const createUserQuery = `
                INSERT INTO user(name,username,password,gender)
                VALUES
                    (
                        '${name}',
                        '${username}',
                        '${hashedPassword}',
                        "${gender}"
                    );`;
      const newUser = await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//login user
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getuserDetails = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getuserDetails);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "saikumar");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//middleware for authentication
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "saikumar", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//get latest tweets of people
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQeury = `
  SELECT 
        user.username,
        tweet.tweet,
        tweet.date_time
    FROM 
        (user INNER JOIN follower ON user.user_id = follower.following_user_id)
        INNER JOIN tweet ON follower.follower_user_id = tweet.user_id
    WHERE 
        user.username = '${username}'
     ORDER BY tweet.date_time DESC
     LIMIT 4;`;
  const tweets = await db.all(getTweetsQeury);
  response.send(
    tweets.map((eachObject) => {
      return {
        username: eachObject.username,
        tweet: eachObject.tweet,
        dateTime: eachObject.date_time,
      };
    })
  );
});

//Returns the list of all names of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getFollowingQuery = `
        SELECT 
            user.name
        FROM 
            user INNER JOIN follower ON user.user_id = follower.following_user_id
        WHERE
            follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${username}');
    `;
  const following = await db.all(getFollowingQuery);
  response.send(following);
});

//Returns the list of all names of people who follows the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getfollowerQuery = `
        SELECT 
            user.name 
        FROM    
            user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE 
            follower.following_user_id = (SELECT user_id FROM user WHERE username = '${username}');
    `;
  const followers = await db.all(getfollowerQuery);
  response.send(followers);
});

//return tweet llikes etc
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;

  // Check if the user follows the owner of the tweet
  const checkFollowingQuery = `
    SELECT COUNT(*) AS count
    FROM follower
    WHERE follower_user_id = (SELECT user_id FROM user WHERE username = ?)
      AND following_user_id = (SELECT user_id FROM tweet WHERE tweet_id = ?)
  `;
  const checkFollowingParams = [username, tweetId];
  const checkFollowingResult = await db.get(
    checkFollowingQuery,
    checkFollowingParams
  );
  if (checkFollowingResult.count === 0) {
    response.status(401).send("Invalid Request");
    return;
  }

  // Get the tweet and its counts
  const getTweetQuery = `
    SELECT tweet.tweet, COUNT(DISTINCT like.user_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies, tweet.date_time
    FROM tweet
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.tweet_id = ?
    GROUP BY tweet.tweet_id
  `;
  const getTweetParams = [tweetId];
  const tweetResult = await db.get(getTweetQuery, getTweetParams);
  response.send({
    tweet: tweetResult.tweet,
    likes: tweetResult.likes,
    replies: tweetResult.replies,
    dateTime: tweetResult.date_time,
  });
});

//7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    // Check if tweet exists
    const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweet = await db.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      // Get list of usernames who liked the tweet
      const getLikesQuery = `
        SELECT user.username FROM user
        INNER JOIN like ON user.user_id = like.user_id
        WHERE like.tweet_id = ${tweetId};
      `;
      const likes = await db.all(getLikesQuery);
      const usernames = likes.map((like) => like.username);
      response.send({ likes: usernames });
    }
  }
);

//8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    // Check if tweet exists
    const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweet = await db.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      // Get list of replies
      const getLikesQuery = `
        SELECT user.name,reply.reply FROM user
        INNER JOIN reply ON user.user_id = reply.user_id
        WHERE reply.tweet_id = ${tweetId};
      `;
      const replies = await db.all(getLikesQuery);
      response.send({ replies: replies });
    }
  }
);

//return a list of all tweets of user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;

  const gettweetsQuery = `
       SELECT tweet.tweet, COUNT(DISTINCT like.user_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies, tweet.date_time AS dateTime
        FROM tweet
             LEFT JOIN like ON tweet.tweet_id = like.tweet_id
            LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE 
            tweet.user_id = (SELECT user_id FROM user WHERE username = '${username}')
        GROUP BY 
            tweet.tweet_id;
    `;

  const tweetslist = await db.all(gettweetsQuery);
  response.send(tweetslist);
});

//creat a tweet in tweet table
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const getuserid = `SELECT user_id FROM user WHERE username = '${username}';`;
  const { user_id } = await db.get(getuserid);
  const date_time = new Date();
  const creatQuery = `
        INSERT INTO tweet(tweet,user_id)
        VALUES(
            '${tweet}',
            ${user_id}
        );
    `;
  await db.run(creatQuery);
  response.send("Created a Tweet");
});

//delete a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const getuserdetailsQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;
    const tweetDetails = await db.get(getuserdetailsQuery);
    if (tweetDetails === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteQuery = `
            DELETE FROM tweet 
            WHERE  
                tweet_id = ${tweetId};
        `;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
