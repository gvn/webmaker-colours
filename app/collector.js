angular.module('wmCollector', ['wmCollector.directives'])
  .run(function () {

  })
  .config(function () {

  })
  .constant('lodash', window._)
  .controller('collectorController', ['$scope', 'lodash',
    function ($scope, _) {

      function massageData(data) {
        data.fontFamilies = [];

        // Create an alphabetical list of font families from extracted fonts

        data.fonts.forEach(function (font) {
          data.fontFamilies.push(font.name);
        });

        data.fontFamilies = _.unique(data.fontFamilies).sort();

        return data;
      }

      addon.port.on("render-data", function(pageData) {
        console.log('render-data', pageData);
        $scope.scrapeData = massageData(pageData);
        $scope.$apply();
      });

      // Defaults

      $scope.swatchGroup = 'hex';


      // UI is ready!
      addon.port.emit("ui-ready");

    }

  ]);
