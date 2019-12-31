const express = require("express");
const url = require("url");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const bodyParser = require("body-parser");
const moment = require("moment");
const uuid = require("uuid/v4");
const multer = require("multer");
const unzipper = require("unzipper");
const stream = require("stream");
const util = require("util");
const path = require("path");
const fs = require("fs");
const fse = require("fs-extra");

const SequelizeStore = require("connect-session-sequelize")(session.Store);

const {
  sha256,
  generatePasswordHash,
  Announcement,
  User,
  Problem,
  Contest,
  Submission,
  Judge
} = require("./database");

async function createServer(sequelize, config) {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", "templates");

  console.log("Copying files from resource folder to data folder...");
  await util.promisify(fse.remove)(
    path.resolve(config.data_folder, "resource")
  );
  await util.promisify(fse.copy)(
    path.resolve(__dirname, "../resource"),
    path.resolve(config.data_folder, "resource")
  );

  async function urlMiddleware(req, res, next) {
    res.locals.url = (...parts) =>
      parts.reduce((cur, part) => {
        return url.resolve(cur.endsWith("/") ? cur : cur + "/", part);
      }, config.server_root);

    res.locals.verdictBadgeType = verdict => {
      if (verdict === "AC") return "success";
      if (verdict === "WJ") return "secondary";
      return "danger";
    };

    res.locals.referrer = req.get("Referrer") || res.locals.url("");
    res.locals.session = req.session;

    res.locals.currentUser = null;
    if (req.session && req.session.userId) {
      res.locals.currentUser = await User.findByPk(req.session.userId);
    }

    res.locals.isAdmin =
      res.locals.currentUser && res.locals.currentUser.role === "admin";
    res.locals.path = req.path;
    res.locals.moment = moment;
    res.locals.config = config;

    res.locals.problem = null;
    res.locals.contest = null;
    res.locals.judge = null;
    res.locals.user = null;

    next();
  }

  async function judgerMiddleware(req, res, next) {
    const { judger_name, judger_key } = req.body || {};
    const judgerEntry = await Judge.findOne({
      where: { name: judger_name || "", key: judger_key || "" }
    });

    if (!judgerEntry) {
      res.json({
        success: false,
        message: "The judger name and key is not valid."
      });
      return;
    }

    res.locals.judger = judgerEntry;
    next();
  }

  async function adminMiddleware(req, res, next) {
    if (!res.locals.isAdmin) res.render("403");
    else next();
  }

  const sessionStore = new SequelizeStore({
    db: sequelize
  });

  app.use(cookieParser());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(
    session({
      secret: config.session_secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false
    })
  );

  sessionStore.sync();

  const upload = multer({ dest: config.upload_path });

  app.use(urlMiddleware);

  app.get("/", async (req, res) => {
    const announcements = await Announcement.findAll();
    res.render("index", { announcements });
  });

  app.get("/user/:username", async (req, res) => {
    const username = req.params.username;
    const user = await User.findOne({ where: { username } });
    const submissions = user
      ? await user.getSubmissions({
          include: [
            { model: User, as: "user" },
            { model: Problem, as: "problem" }
          ],
          order: [["time", "DESC"]],
          limit: 10
        })
      : [];

    res.render("user", { user, submissions });
  });

  app.get("/user/:username/edit", async (req, res) => {
    const user = await User.findOne({
      where: { username: req.params.username }
    });

    if (
      user.username === res.locals.currentUser.username ||
      res.locals.isAdmin
    ) {
      res.render("user.edit.ejs", { user, errors: [], messages: [] });
    } else {
      res.render("403");
    }
  });

  app.post("/user/:username/edit", async (req, res) => {
    const user = await User.findOne({
      where: { username: req.params.username }
    });

    if (
      user.username !== res.locals.currentUser.username &&
      !res.locals.isAdmin
    ) {
      res.render("403");
      return;
    }

    const errors = [];
    const messages = [];

    if (req.body.password && typeof req.body.password === "string") {
      if (req.body.password.length >= 6) {
        const [salt, hash] = generatePasswordHash(req.body.password);
        user.passwordHash = hash;
        user.passwordSalt = salt;
        await user.save();
        messages.push("The password is changed.");
      } else {
        errors.push("The new password is too short.");
      }
    }

    res.render("user.edit.ejs", { user, errors, messages });
  });

  app.get("/contests", async (req, res) => {
    const contests = await Contest.findAll();
    res.render("contests", { contests });
  });

  app.get("/contest/new", async (req, res) => {
    const contest = new Contest();
    await contest.save();

    res.redirect(res.locals.url(`contest/${contest.id}/edit`));
  });

  app.get("/contest/:contest", async (req, res) => {
    const id = isFinite(+req.params.contest) ? +req.params.contest : -1;
    const contest = await Contest.findByPk(id);

    if (contest) {
      contest.problems = await contest.getProblems();
    }

    res.render("contest", { contest });
  });

  app.get("/contest/:contest/scoreboard", async (req, res) => {
    const contestId = isFinite(+req.params.contest) ? +req.params.contest : -1;
    const contest = await Contest.findByPk(contestId, {
      include: [{ model: Problem, as: "problems" }]
    });

    if (!contest) {
      res.render("403");
      return;
    }

    const submissions = await contest.getSubmissions({
      order: [["time", "ASC"]],
      include: [
        { model: User, as: "user" },
        { model: Problem, as: "problem" }
      ]
    });

    const submissionGrid = {};
    const users = new Map();

    for (const submission of submissions) {
      if (!users.get(submission.user.username))
        users.set(submission.user.username, submission.user);
      if (!submissionGrid[submission.user.username])
        submissionGrid[submission.user.username] = {};
      if (
        !submissionGrid[submission.user.username][submission.problem.id] ||
        (submissionGrid[submission.user.username][submission.problem.id]
          .verdict !== "AC" &&
          submission.verdict === "AC")
      ) {
        submissionGrid[submission.user.username][
          submission.problem.id
        ] = submission;
      }
    }

    res.render("scoreboard", {
      contest,
      submissions: submissionGrid,
      users: [...users.entries()].map(([, user]) => user)
    });
  });

  app.get("/contest/:contest/edit", adminMiddleware, async (req, res) => {
    const id = isFinite(+req.params.contest) ? +req.params.contest : -1;
    const contest = await Contest.findByPk(id);

    if (contest) {
      contest.problems = await contest.getProblems();
    }

    res.render("contest.edit.ejs", { contest });
  });

  app.post("/contest/:contest/edit", adminMiddleware, async (req, res) => {
    const id = isFinite(+req.params.contest) ? +req.params.contest : -1;
    const contest = await Contest.findByPk(id);

    if (contest) {
      const startTime = new Date(
        req.body.start_date + " " + req.body.start_time
      );
      const endTime = new Date(req.body.end_date + " " + req.body.end_time);

      contest.title = req.body.title;
      contest.startTime = startTime;
      contest.endTime = endTime;

      if (req.body.new_problem) {
        const problemId = isFinite(+req.body.new_problem)
          ? +req.body.new_problem
          : -1;
        const problem = await Problem.findByPk(problemId);

        if (!(await contest.hasProblem(problem)))
          await contest.addProblem(problem);
      }

      await contest.save();

      contest.problems = await contest.getProblems();
    }

    res.render("contest.edit.ejs", { contest });
  });

  app.get("/contest/:contest/delete", adminMiddleware, async (req, res) => {
    const id = req.params.contest;
    const contest = await Contest.findByPk(id);

    if (contest) {
      await contest.destroy();
    }

    res.redirect(res.locals.url("contests"));
  });

  app.get("/contest/:contest/problem/:problem", async (req, res) => {
    const contestId = req.params.contest;
    const problemId = req.params.problem;
    const contest = await Contest.findByPk(contestId);
    let problem = await Problem.findByPk(problemId);

    if (!(await contest.hasProblem(problem))) {
      problem = null;
    }

    if (problem) {
      problem.author = await problem.getUser();
      problem.metadata = JSON.parse(problem.metadata);
    }

    res.render("problem", { contest, problem });
  });

  app.get(
    "/contest/:contest/problem/:problem/submissions",
    async (req, res) => {
      const contestId = isFinite(+req.params.contest)
        ? +req.params.contest
        : -1;
      const contest = await Contest.findByPk(contestId);
      const problemId = isFinite(+req.params.problem)
        ? +req.params.problem
        : -1;
      const problem = await Problem.findByPk(problemId);

      if (!(await contest.hasProblem(problem))) {
        res.render("403");
        return;
      }

      const submissions = await problem.getSubmissions({
        where: { contestId: contest.id },
        include: [
          { model: User, as: "user" },
          { model: Problem, as: "problem" }
        ],
        order: [["time", "DESC"]]
      });

      res.render("submissions", { problem, submissions, contest });
    }
  );

  app.post("/contest/:contest/problem/:problem/submit", async (req, res) => {
    if (!res.locals.currentUser) {
      res.render("403");
      return;
    }

    const contestId = isFinite(+req.params.contest) ? +req.params.contest : -1;
    const contest = await Contest.findByPk(contestId);
    const problemId = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const problem = await Problem.findByPk(problemId);

    if (!contest || !problem || !(await contest.hasProblem(problem))) {
      res.render("403");
      return;
    }

    const { language, code } = req.body;

    const submission = new Submission();
    submission.language = language;
    submission.body = code;

    await submission.save();
    await submission.setUser(res.locals.currentUser);
    await submission.setProblem(problem);
    await submission.setContest(contest);

    await submission.save();

    res.redirect(
      res.locals.url(`problem/${problemId}/submission/${submission.id}`)
    );
  });

  app.get(
    "/contest/:contest/problem/:problem/delete",
    adminMiddleware,
    async (req, res) => {
      const redirect =
        req.get("Referrer") || res.local.url(`contest/${contest.id}/edit`);
      const contestId = isFinite(+req.params.contest)
        ? +req.params.contest
        : -1;
      const problemId = isFinite(+req.params.problem)
        ? +req.params.problem
        : -1;
      const contest = await Contest.findByPk(contestId);
      const problem = await Problem.findByPk(problemId);

      if (await contest.hasProblem(problem)) {
        await contest.removeProblem(problem);
      }

      res.redirect(redirect);
    }
  );

  app.get("/problems", async (req, res) => {
    const problems = await Problem.findAll();
    res.render("problems", { problems });
  });

  app.get("/problem/new", adminMiddleware, async (req, res) => {
    const problem = new Problem();
    await problem.save();

    res.redirect(res.locals.url(`problem/${problem.id}/edit`));
  });

  app.get("/problem/:problem", async (req, res) => {
    const id = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const problem = await Problem.findByPk(id);

    if (problem) {
      problem.author = await problem.getUser();
      problem.metadata = JSON.parse(problem.metadata);
    }

    res.render("problem", { problem, contest: null });
  });

  app.get("/problem/:problem/submit", async (req, res) => {
    res.redirect(res.locals.url(`problem/${req.params.problem}`));
  });

  app.post("/problem/:problem/submit", async (req, res) => {
    if (!res.locals.currentUser) {
      res.render("403");
      return;
    }

    const problemId = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const problem = await Problem.findByPk(problemId);

    if (!problem) {
      res.render("403");
      return;
    }

    const { language, code } = req.body;

    const submission = new Submission();
    submission.language = language;
    submission.body = code;

    await submission.save();
    await submission.setUser(res.locals.currentUser);
    await submission.setProblem(problem);

    await submission.save();

    res.redirect(
      res.locals.url(`problem/${problemId}/submission/${submission.id}`)
    );
  });

  app.get("/problem/:problem/submissions", async (req, res) => {
    const id = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const problem = await Problem.findByPk(id);
    const submissions = await problem.getSubmissions({
      include: [
        { model: User, as: "user" },
        { model: Problem, as: "problem" }
      ],
      order: [["time", "DESC"]]
    });

    res.render("submissions", { problem, submissions });
  });

  app.get("/problem/:problem/submission/:submission", async (req, res) => {
    const problemId = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const submissionId = isFinite(+req.params.submission)
      ? +req.params.submission
      : -1;
    const problem = await Problem.findByPk(problemId);
    let submission = await Submission.findByPk(submissionId, {
      include: [
        { model: Problem, as: "problem" },
        { model: User, as: "user" }
      ]
    });

    if (!(await problem.hasSubmission(submission))) {
      submission = null;
    }

    if (submission && submission.judgerOutput) {
      submission.judgerOutput = JSON.parse(submission.judgerOutput);
    }

    res.render("submission", { problem, submission });
  });

  app.get(
    "/problem/:problem/submission/:submission/rejudge",
    adminMiddleware,
    async (req, res) => {
      const problemId = isFinite(+req.params.problem)
        ? +req.params.problem
        : -1;
      const submissionId = isFinite(+req.params.submission)
        ? +req.params.submission
        : -1;
      const problem = await Problem.findByPk(problemId);
      let submission = await Submission.findByPk(submissionId, {
        include: [
          { model: Problem, as: "problem" },
          { model: User, as: "user" }
        ]
      });

      submission.verdict = "WJ";
      submission.judger = "";
      submission.judgerOutput = "{}";

      await submission.save();

      if (!(await problem.hasSubmission(submission))) {
        submission = null;
      }

      res.redirect(
        res.locals.url(`problem/${problemId}/submission/${submissionId}`)
      );
    }
  );

  app.get("/problem/:problem/edit", adminMiddleware, async (req, res) => {
    const id = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const problem = await Problem.findByPk(id);

    if (problem) {
      problem.metadata = JSON.parse(problem.metadata);
    }

    res.render("problem.edit.ejs", { problem, errors: [] });
  });

  app.post(
    "/problem/:problem/edit",
    adminMiddleware,
    upload.fields([{ name: "test_data", maxCount: 1 }]),
    async (req, res) => {
      const id = isFinite(+req.params.problem) ? +req.params.problem : -1;
      const problem = await Problem.findByPk(id);
      const errors = [];

      if (problem) {
        const {
          title,
          description,
          time_limit,
          memory_limit,
          input_format,
          output_format
        } = req.body;

        if (req.files.test_data && req.files.test_data.length) {
          const testData = req.files.test_data[0];
          const files = {};

          await new Promise((resolve, reject) => {
            const zip = new stream.PassThrough();
            zip.end(testData.buffer);
            zip
              .pipe(unzipper.Parse())
              .on("entry", async entry => {
                files[entry.path] = await entry.buffer();
                console.log("Read", entry.path);
              })
              .on("finish", () => resolve());
          });

          let testCount = 0;
          const writeFile = util.promisify(fs.writeFile);
          for (const file in files) {
            if (files[file + ".a"]) {
              testCount++;
              const testName = testCount.toString();
              await writeFile(
                path.resolve(
                  config.data_folder,
                  problem.id.toString(),
                  testName
                ),
                files[file]
              );
              await writeFile(
                path.resolve(
                  config.data_folder,
                  problem.id.toString(),
                  testName + ".a"
                ),
                files[file + ".a"]
              );
            }
          }

          let testcaseList = "";
          for (let i = 1; i <= testCount; i++) {
            testcaseList += `${i} ${i}.a\n`;
          }

          await writeFile(
            path.resolve(
              config.data_folder,
              problem.id.toString(),
              "testcases.txt"
            ),
            testcaseList
          );
        }

        problem.title = title;
        problem.timeLimit = isFinite(+time_limit) ? +time_limit : 0;
        problem.memoryLimit = isFinite(+memory_limit) ? +memory_limit : 0;

        problem.metadata = JSON.stringify({
          description,
          input_format,
          output_format
        });

        await problem.save();

        // For rendering purposes
        problem.metadata = JSON.parse(problem.metadata);

        res.render("problem.edit.ejs", { problem });
        return;
      }

      res.render("problem.edit.ejs", { problem });
    }
  );

  app.get("/problem/:problem/delete", adminMiddleware, async (req, res) => {
    const id = isFinite(+req.params.problem) ? +req.params.problem : -1;
    const problem = await Problem.findByPk(id);

    if (problem) {
      await problem.destroy();
    }

    res.redirect(res.locals.url("problems"));
  });

  app.get("/judges", adminMiddleware, async (req, res) => {
    const judges = await Judge.findAll();
    res.render("judges", { judges });
  });

  app.post("/judge/new", adminMiddleware, async (req, res) => {
    const name = req.body.name;
    const judge = new Judge({
      name,
      key: uuid()
    });

    await judge.save();
    res.redirect(res.locals.url("judges"));
  });

  app.get("/judge/:judge/delete", adminMiddleware, async (req, res) => {
    const id = isFinite(+req.params.judge) ? +req.params.judge : -1;
    const judge = await Judge.findByPk(id);

    if (judge) {
      await judge.destroy();
    }

    res.redirect(res.locals.url("judges"));
  });

  app.get("/auth/login", async (req, res) => {
    res.render("login", { redirect: "" });
  });

  app.post("/auth/login", async (req, res) => {
    const user =
      req.body.username &&
      (await User.findOne({ where: { username: req.body.username } }));

    if (user) {
      const hash =
        req.body.password && sha256(req.body.password + user.passwordSalt);
      if (hash === user.passwordHash) {
        req.session.userId = user.id;
        res.redirect(req.body.redirect);
        return;
      }
    }

    res.render("login", { redirect: req.body.redirect });
  });

  app.get("/auth/register", async (req, res) => {
    res.render("register", { redirect: "", errors: [] });
  });

  app.post("/auth/register", async (req, res) => {
    const username = req.body.username || "";
    const displayName = req.body.display_name || "";
    const password = req.body.password || "";
    const [passwordSalt, passwordHash] = generatePasswordHash(password);

    const errors = [];
    if (!username) errors.push("Username must not be empty.");
    if (null != (await User.findOne({ where: { username } })))
      errors.push("The username is already taken.");
    if (!displayName) errors.push("Display name must not be empty.");
    if (!password || password.length < 6)
      errors.push("Password must contain at least 6 characters.");

    if (errors.length) {
      res.render("register", {
        redirect: req.body.redirect,
        errors,
        username,
        displayName
      });
      return;
    }

    const user = new User({
      username,
      displayName,
      passwordSalt,
      passwordHash
    });

    await user.save();
    req.session.userId = user.id;
    res.redirect(req.body.redirect);
  });

  app.get("/auth/logout", async (req, res) => {
    const redirect = req.get("Referrer") || res.locals.url("");
    req.session.destroy();
    res.redirect(redirect);
  });

  app.get("/judger/ping", judgerMiddleware, async (req, res) => {
    const { judger } = res.locals;

    judger.ipAddress =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    judger.lastPing = new Date();

    await judger.save();

    res.json({
      success: true
    });
  });

  // Pops a pending submission from the judge queue.
  app.get("/judger/get", judgerMiddleware, async (req, res) => {
    const judger = res.locals.judger;
    const submission = await Submission.findOne({
      where: { verdict: "WJ", judger: "" }
    });

    if (!submission) {
      res.json({ success: true, id: null, submission: null });
      return;
    }

    // Attempt to update the submission.
    await Submission.update(
      { judger: judger.name },
      {
        fields: ["judger"],
        where: {
          id: submission.id,
          judger: ""
        }
      }
    );

    const updatedSubmission = await Submission.findByPk(submission.id, {
      include: [{ model: Problem, as: "problem" }]
    });

    if (updatedSubmission.judger === judger.name) {
      // Successfully claimed job.
      console.log(
        "Judger %s claimed submission %d",
        judger.name,
        updatedSubmission.id
      );
      res.json({
        success: true,
        id: updatedSubmission.id,
        submission: updatedSubmission.toJSON()
      });
    } else {
      // The job is already taken.
      res.json({ success: true, id: null, submission: null });
    }
  });

  app.get("/judger/file", judgerMiddleware, async (req, res) => {
    const file = req.body.file;
    const location = file ? path.resolve(config.data_folder, file) : "";

    if (location && fs.existsSync(location)) {
      res.sendFile(location);
    } else {
      res.json({
        success: false,
        message: "The file does not exist."
      });
    }
  });

  app.get("/judger/set", judgerMiddleware, async (req, res) => {
    const id = req.body.id;

    if (!id) {
      res.json({
        success: false,
        message: "No submission ID is given."
      });
      return;
    }

    const submission = await Submission.findByPk(+id);
    const { verdict, judgerOutput } = req.body;

    if (verdict) submission.verdict = verdict;
    if (judgerOutput) submission.judgerOutput = judgerOutput;

    await submission.save();

    res.json({
      success: true
    });
  });

  console.log("Server listening on port %d", config.port);
  app.listen(config.port);
}

module.exports = { createServer };
