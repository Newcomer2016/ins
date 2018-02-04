let config = {
    // 部分ins用户设置需关注后才可获取, 可配置用户cookie 键为"sessionid"
    sessionCookie: '',

    // 抓取用户列表
    downUsers: [],

    userFollow: '',

    savePath: './downloads',

    maxUserOccurs: 1,
    maxMediaOccurs: 8,
    timeout: 10000,
    proxy: '',
    igrCAErr: false
};

module.exports = config;
