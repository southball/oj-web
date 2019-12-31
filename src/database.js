const Sequelize = require("sequelize");
const crypto = require("crypto");
const uuid = require("uuid/v4");

class Announcement extends Sequelize.Model {}
class User extends Sequelize.Model {}
class Problem extends Sequelize.Model {}
class Contest extends Sequelize.Model {}
class Submission extends Sequelize.Model {}
class Judge extends Sequelize.Model {}

function sha256(plaintext, salt = "") {
  const hasher = crypto.createHash("sha256");
  hasher.update(plaintext + salt);
  return hasher.digest("hex");
}

function generatePasswordHash(plaintext) {
  const salt = uuid();
  const hash = sha256(plaintext, salt);

  return [salt, hash];
}

async function createModels(sequelize) {
  Announcement.init(
    {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: () => new Date()
      },
      title: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      content: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      pinned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      shown: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }
    },
    {
      sequelize,
      modelName: "Announcement"
    }
  );

  User.init(
    {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      username: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      displayName: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      passwordHash: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: ""
      },
      passwordSalt: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: ""
      },
      role: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" }
    },
    {
      sequelize,
      modelName: "User"
    }
  );

  Problem.init(
    {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      title: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: "{}" },
      timeLimit: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      memoryLimit: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0
      },
      isPublic: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }
    },
    {
      sequelize,
      modelName: "Problem"
    }
  );

  Contest.init(
    {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      title: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      startTime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: () => new Date()
      },
      endTime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: () => new Date()
      },
      isPublic: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }
    },
    {
      sequelize,
      modelName: "Contest"
    }
  );

  Submission.init(
    {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      time: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: () => new Date()
      },
      language: { type: Sequelize.STRING, allowNull: false, defaultValue: "" },
      body: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      judger: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      verdict: { type: Sequelize.TEXT, allowNull: false, defaultValue: "WJ" },
      judgerOutput: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: "{}"
      }
    },
    {
      sequelize,
      modelName: "Submission"
    }
  );

  Judge.init(
    {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      key: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      ipAddress: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      lastPing: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: new Date(0)
      }
    },
    {
      sequelize,
      modelName: "Judge"
    }
  );

  Contest.belongsToMany(Problem, { as: "problems", through: "ContestProblem" });
  Problem.belongsToMany(Contest, { as: "contest", through: "ContestProblem" });

  Problem.belongsTo(User, { as: "user", foreignKey: "userId" });
  User.hasMany(Problem, { as: "problems", foreignKey: "userId" });

  Submission.belongsTo(Contest, { as: "contest", foreignKey: "contestId" });
  Contest.hasMany(Submission, { as: "submissions", foreignKey: "contestId" });

  Submission.belongsTo(User, { as: "user", foreignKey: "userId" });
  Submission.belongsTo(Problem, { as: "problem", foreignKey: "problemId" });
  User.hasMany(Submission, { as: "submissions", foreignKey: "userId" });
  Problem.hasMany(Submission, { as: "submissions", foreignKey: "problemId" });

  await sequelize.sync();
  // await sequelize.sync({ force: true });
}

async function populateData(sequelize) {
  /**
  await Announcement.bulkCreate([
    {
      date: new Date("Jan 1 2019"),
      title: "Welcome!",
      content: "Welcome to the <b>Online Judge</b>!",
      pinned: true,
      shown: true
    }
  ]);

  await User.bulkCreate([
    {
      username: "southball",
      passwordHash:
        "b9adef17fa69e8a421d75edfff1fd46fd376ca506b05a19cad2e2ece73d06567",
      passwordSalt: "560850a8-67e4-46f3-828d-90592c9e6e21",
      role: "admin"
    },
    {
      username: "demo",
      passwordHash:
        "fd1826fc9ca7f174f1858cb531ae93cd681d4deb928840412b6585e5cf43c2c2",
      passwordSalt: "9536e925-b066-49f7-9c77-f5406daa23ae",
      role: ""
    }
  ]);

  await Problem.bulkCreate([
    {
      title: "A + B Problem",
      metadata: JSON.stringify({
        description: "Given two integers A and B, output A + B.",
        input_format:
          "The first line contains two integers, A and B, separated by a single space.",
        output_format:
          "Output a line consisting of a single integer, the value of A + B."
      }),
      timeLimit: 1000,
      memoryLimit: 256000,
      isPublic: true
    },
    {
      title: "Hello World",
      metadata: JSON.stringify({
        description: 'Output "Hello World" to the standard output.',
        input_format: "There is no input.",
        output_format:
          'Output "Hello World" on a single line, without the quotes.'
      }),
      timeLimit: 1000,
      memoryLimit: 256000,
      isPublic: true
    }
  ]);

  await Contest.bulkCreate([
    {
      title: "Test Contest",
      startTime: new Date("Jan 01 2019"),
      endTime: new Date("Dec 31 2099"),
      isPublic: true
    }
  ]);

  await Submission.bulkCreate([
    {
      time: new Date("Jan 01 2019"),
      language: "cpp",
      body: `#include <bits/stdc++.h>
using namespace std;
int main() {
  int a, b;
  cin >> a >> b;
  cout << a + b << endl;
}`,
      judger: "",
      judgerOutput: "{}"
    },
    {
      time: new Date("Jan 02 2019"),
      language: "cpp",
      body: `#include <bits/stdc++.h>
using namespace std;
int main() {
  int a, b;
  cin << a << b;
}`,
      judger: "",
      judgerOutput: "{}"
    }
  ]);

  await Judge.bulkCreate([
    {
      name: "judge1",
      key: "5f535b19-02b6-4b8a-be42-ac50a297bbb8"
    }
  ]);

  const contest1 = await Contest.findByPk(1);
  const problem1 = await Problem.findByPk(1);
  const problem2 = await Problem.findByPk(2);
  const submission1 = await Submission.findByPk(1);
  const submission2 = await Submission.findByPk(2);
  const user1 = await User.findByPk(1);

  await problem1.setUser(user1);
  await problem2.setUser(user1);

  await contest1.setProblems([problem1]);
  await submission1.setProblem(problem1);
  await submission1.setUser(user1);
  await submission2.setProblem(problem1);
  await submission2.setUser(user1);
  */

  if ((await User.findAll()).length === 0) {
    const [salt, hash] = generatePasswordHash("admin");
    const user = new User({
      username: "admin",
      passwordSalt: salt,
      passwordHash: hash,
      role: "admin"
    });

    await user.save();
  }
}

async function connectDatabase(config) {
  const sequelize = new Sequelize(config);
  await sequelize.authenticate();

  await createModels(sequelize);
  await populateData(sequelize);

  return sequelize;
}

module.exports = {
  sha256,
  generatePasswordHash,
  connectDatabase,
  User,
  Problem,
  Contest,
  Announcement,
  Submission,
  Judge
};
